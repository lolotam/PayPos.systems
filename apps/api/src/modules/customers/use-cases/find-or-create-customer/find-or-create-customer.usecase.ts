import type {
  Customer,
  FindOrCreateCustomerInput,
  FindOrCreateScopedCustomerInput,
} from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { customerForReception } from '../../domain/customer.ts';
import { InvalidCustomerProfileError } from '../../domain/errors.ts';
import { normalizePhone } from '../../domain/phone.ts';
import { isEmailShape, isNoteShape, validateBirthday } from '../../domain/profile.ts';
import type {
  CustomerScope,
  CustomerTransactions,
} from '../../ports/customer-transactions.port.ts';

export { InvalidCustomerPhoneError, InvalidCustomerProfileError } from '../../domain/errors.ts';

/** نطاق الطلب: الشركة نفسها، أو نشاط، أو فرع — بيحدد مين الملاحظة تتحفظ تحته. */
export type CustomerRequestScope =
  | { readonly kind: 'company' }
  | { readonly kind: 'business'; readonly businessId: string }
  | { readonly kind: 'branch'; readonly branchId: string };

/**
 * أمر الإنشاء: النطاق بيحدد شكل المدخلات المسموح — مسار الشركة مالوش note أصلاً (S-4)،
 * ومسار النشاط والفرع بيقبلوها. الشكل ده بيخلي «company + note» غلطة وقت الترجمة مش
 * وقت التشغيل.
 */
export type FindOrCreateCustomerCommand =
  | {
      readonly companyId: string;
      readonly userId: string;
      readonly scope: { readonly kind: 'company' };
      readonly input: FindOrCreateCustomerInput;
    }
  | {
      readonly companyId: string;
      readonly userId: string;
      readonly scope: { readonly kind: 'business'; readonly businessId: string };
      readonly input: FindOrCreateScopedCustomerInput;
    }
  | {
      readonly companyId: string;
      readonly userId: string;
      readonly scope: { readonly kind: 'branch'; readonly branchId: string };
      readonly input: FindOrCreateScopedCustomerInput;
    };

/**
 * أمر الإنشاء من غير هوية الشركة والمستخدم — الـ controller بيملاها من الجلسة المكتشفة.
 * التوزيع على أفرع الأمر بيحافظ على الربط بين النطاق وشكل المدخلات المسموح.
 */
export type FindOrCreateCustomerBody = FindOrCreateCustomerCommand extends infer Command
  ? Command extends { readonly companyId: string; readonly userId: string }
    ? Omit<Command, 'companyId' | 'userId'>
    : never
  : never;

/**
 * ملاحظة الطلب: مسار النشاط والفرع بيقبلوها، ومسار الشركة لأ (S-4). لو وصل command من
 * غير العقد وحمل note مع مسار الشركة، الرفض صريح — الصمت كان هيعني ضياع ملاحظة.
 *
 * @param command أمر الإنشاء
 * @returns الملاحظة، أو undefined لو المسار مش بيقبلها
 */
function noteOf(command: FindOrCreateCustomerCommand): string | undefined {
  if (command.scope.kind === 'company') {
    if ('note' in command.input) throw new InvalidCustomerProfileError();
    return undefined;
  }
  return 'note' in command.input ? command.input.note : undefined;
}

// يربط الاستقبال بهوية الشركة دون تعديل بيانات عميل موجود، ويسجل الإنشاء فقط.
export class FindOrCreateCustomerUseCase {
  constructor(
    private readonly transactions: CustomerTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: FindOrCreateCustomerCommand): Promise<Customer> {
    const phone = normalizePhone(command.input.phone);
    const note = noteOf(command);
    // قواعد الملف الشخصي قبل أي معاملة: تاريخ ميلاد مش تقويمي أو بريد مش بالشكل المسموح.
    if (command.input.birthday !== undefined) validateBirthday(command.input.birthday);
    if (command.input.email !== undefined && !isEmailShape(command.input.email))
      throw new InvalidCustomerProfileError();
    if (note !== undefined && !isNoteShape(note)) throw new InvalidCustomerProfileError();

    return this.transactions.run(command, async (scope) => {
      const existing = await scope.findByPhone(phone);
      // العميل الموجود بيتقفل عليه زي ما هو: حقول الملف الشخصي والملاحظة بتتجاهل خالص (S-3).
      if (existing !== null) return customerForReception(existing);

      const at = this.clock.now();
      // نشاط الملاحظة بيتقري بس لما تكون فيه ملاحظة؛ مسار الشركة مالوش نشاط أصلاً.
      const businessId = note === undefined ? null : await this.noteBusiness(scope, command.scope);
      // TODO(spec): CI-Q10 activation in 34-pre-2 — النوع مطلوب للعميل الجديد من هنا؛ في 34-pre-1
      // النوع اختياري وغيابه بيتخزّن NULL، فمفيش اختبار بيقبله على حالة إجبارية.
      const result = await scope.create({
        id: this.ids.newId(),
        name: command.input.name,
        phone,
        locale: command.input.locale,
        at,
        ...(command.input.gender !== undefined ? { gender: command.input.gender } : {}),
        ...(command.input.birthday !== undefined ? { birthday: command.input.birthday } : {}),
        ...(command.input.email !== undefined ? { email: command.input.email } : {}),
      });
      const body = customerForReception(result.customer);
      // المنافس اللي كسب سباق الإنشاء هو الوحيد اللي بيكتب الملاحظة والسجل (CUS-03).
      if (!result.created) return body;
      if (note !== undefined && businessId !== null) {
        await scope.addNote({
          customerId: result.customer.id,
          businessId,
          note,
          at,
        });
      }
      // الهاتف الكامل ممنوع في سجل العميل أيضاً؛ الـ snapshot له نفس قائمة حقول الاستجابة الآمنة.
      await scope.audit.record({
        entity: 'customer',
        entityId: body.id,
        action: 'created',
        after: body,
      });
      return body;
    });
  }

  /** النشاط اللي بتتحفظ تحته الملاحظة: مسار النشاط مباشرة، ومسار الفرع بيحوّل لنشاطه. */
  private async noteBusiness(
    scope: CustomerScope,
    requestScope: CustomerRequestScope,
  ): Promise<string | null> {
    if (requestScope.kind === 'company') return null;
    if (requestScope.kind === 'business') return requestScope.businessId;
    return scope.branchBusiness(requestScope.branchId);
  }
}
