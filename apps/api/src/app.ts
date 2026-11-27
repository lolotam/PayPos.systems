import { API_CONTROLLERS } from './app-controllers.ts';
export { API_CONTROLLERS } from './app-controllers.ts';
import type { AppDependencies, AppOptions } from './app-dependencies.ts';
export type { AppDependencies, AppOptions } from './app-dependencies.ts';
import { buildAdapter, mountRequestLogging } from './app-http.ts';
export { buildAdapter, API_MAX_HEADER_BYTES } from './app-http.ts';
import { SHUTDOWN, ShutdownHook } from './shared/application-shutdown.ts';
import 'reflect-metadata';

import { Module, type DynamicModule, type Provider, type Type } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger, type Logger } from '@pospay/observability';

import {
  AUTHENTICATED_WRITES,
  COMPANY_HEADER,
  assertAuthenticatedWritesDeclared,
  assertEveryRouteGuarded,
  identityProviders,
  passwordResetProviders,
  readCommissionPlanAccess,
  readCommissionPlanListAccess,
  readCommissionFeatureEnabled,
  readCommissionReviewAccess,
  readCommissionActorMembership,
  readCommissionApprovers,
  readCommissionReturnAccess,
  readCommissionScope,
  readCommissionRequesterMembership,
} from './modules/identity/index.ts';
import { settingsProviders } from './modules/settings/index.ts';
import { notificationsProviders } from './modules/notifications/index.ts';
import { mountResendSecurity, mountWhatsappSecurity } from './modules/notifications/index.ts';
import {
  businessCalendar,
  businessTimeZone,
  readCommissionBranchNames,
  tenancyProviders,
} from './modules/tenancy/index.ts';
import {
  bindCustomerImportFiles,
  customersProviders,
  readCommissionCustomerNames,
  RATING_ROUTE,
  ratingAdmissionHook,
  ratingCorsPolicy,
} from './modules/customers/index.ts';
import {
  bindServiceImportFiles,
  catalogProviders,
  readCommissionOverrideServices,
  readCommissionServiceNames,
  readSessionServices,
} from './modules/catalog/index.ts';
import { ordersProviders } from './modules/orders/index.ts';
import { enableApiCors } from './shared/cors.ts';
import {
  createDocumentRenderTransport,
  createDocumentStatusReader,
  createRedisDocumentBytesStore,
  employeeExistsInBusiness,
  lockEmployeeForUpdate,
  readCommissionBranchAttachments,
  readCommissionEstimateEmployees,
  readCommissionStatementEmployees,
  readCommissionPlanEmployeeNames,
  mountStaffAccessGate,
  staffProviders,
} from './modules/staff/index.ts';
import {
  commissionsProviders,
  commissionStatementExportProviders,
  type CommissionEstimateProviders,
} from './modules/commissions/index.ts';
import { commissionApprovalBindings } from './commission-approval-bindings.ts';
import { commissionOwnEstimateBindings } from './commission-own-estimate-bindings.ts';
import { commissionAlertRules } from './modules/commissions/persistence/commission-alert-rule.adapter.ts';
import { documentFileFacts, filesProviders } from './modules/files/index.ts';
import { mountAuthRoutes } from './shared/auth-routes.ts';
import { DATABASE } from './shared/database.token.ts';
import { RATE_LIMITER } from './shared/device-authenticator.ts';
import { createRedisRateLimiter } from './shared/adapters/redis-rate-limiter.ts';
import { EnvelopeExceptionFilter } from './shared/exception.filter.ts';
import { API_LOG_EVENTS } from './shared/log-events.ts';
import { PinoNestLogger } from './shared/nest-logger.ts';
import { READINESS_CHECKS, singleFlight } from './shared/readiness.ts';
import type { RateLimiter } from './shared/ports/rate-limiter.port.ts';
import { PERSONAL_AUTHENTICATION } from './shared/personal-authentication.ts';
import { AUTH_SERVICE, SessionGuard } from './shared/session.guard.ts';
import { mountMemberInvitationGate } from './shared/staff-access-routes.ts';

/** نطاق القارئ الفعّال من identity بشكل مزوّد التقدير والكشف: الرفض الموحّد والميزة المقفولة سببان منفصلان. */
async function commissionReaderScope(
  ...args: Parameters<typeof readCommissionScope>
): ReturnType<CommissionEstimateProviders['scope']> {
  const scope = await readCommissionScope(...args);
  if (scope.kind === 'forbidden') return { kind: 'forbidden' };
  if (scope.kind === 'feature_disabled') return { kind: 'feature_disabled' };
  return {
    kind: 'scope',
    businessWide: scope.scope.businessWide,
    branchIds: scope.scope.branchIds,
  };
}

function commissionBindings(deps: AppDependencies) {
  return commissionsProviders(
    deps.database,
    deps.ids ?? systemUuidV7(),
    {
      businessCalendar,
      employeeLock: lockEmployeeForUpdate,
      access: readCommissionPlanAccess,
      // وجود الخدمة بس: قاعدة الكتالوج الحية مش مرجع تاريخ، واللقطة المحفوظة على السطر هي المرجع.
      serviceReader: async (tx, companyId, businessId, serviceId) =>
        (await readSessionServices(tx, companyId, businessId, [serviceId])).length > 0,
    },
    {
      access: readCommissionPlanListAccess,
      timeZone: businessTimeZone,
      employeeExists: employeeExistsInBusiness,
      // خدمات شاشة التجاوزات (49-2a): صلاحية الخطط بتبدل مفيش صلاحية خدمات، فالأسماء بتيجي من الكتالوج.
      services: readCommissionOverrideServices,
    },
    {
      access: readCommissionPlanListAccess,
      timeZone: businessTimeZone,
      employeeNames: readCommissionPlanEmployeeNames,
    },
    { access: readCommissionPlanListAccess },
    {
      // تقدير العمولة (50-5): النطاق الفعّال من identity، والاسم والارتباطات من staff.
      scope: commissionReaderScope,
      featureEnabled: readCommissionFeatureEnabled,
      employees: readCommissionEstimateEmployees,
      attachments: readCommissionBranchAttachments,
      serviceNames: readCommissionServiceNames,
    },
    {
      // كشف العمولة (51-1): نفس النطاق والميزة، والأسماء من tenancy وcustomers والكتالوج، والإنشاء بفحصه الخاص.
      providers: {
        scope: commissionReaderScope,
        featureEnabled: readCommissionFeatureEnabled,
        employees: readCommissionStatementEmployees,
        attachments: readCommissionBranchAttachments,
        branchNames: readCommissionBranchNames,
        serviceNames: readCommissionServiceNames,
        customerNames: readCommissionCustomerNames,
      },
      reviewAccess: readCommissionReviewAccess,
      businessCalendar,
      // المراجعة والإرجاع (52-1): فحص الإرجاع (مراجع أو معتمد)، وعضوية الفاعل، ومستلمو إشعار
      // الاعتماد، وقواعد التنبيه اللي بتحدد التشغيل والقناة بس (DR-008).
      returnAccess: readCommissionReturnAccess,
      actorMembership: readCommissionActorMembership,
      approvers: readCommissionApprovers,
      alertRules: commissionAlertRules,
      // اعتماد الكشف (53-2): صلاحيته ومفتاحه وتواريخ العمل والعدّاد.
      ...commissionApprovalBindings,
    },
    deps.commissionsClock,
  );
}

/**
 * ربط تصدير كشف العمولات (56-1c): النطاق والميزة وعضوية الطالب من identity، ونقل المستند وبايتاته
 * وحالته من staff (ADR-0049). الوحدة نفسها ما بتستوردش أي منهم.
 */
function commissionStatementExportBindings(deps: AppDependencies) {
  return commissionStatementExportProviders(
    deps.database,
    deps.redis,
    deps.ids ?? systemUuidV7(),
    {
      readers: {
        scope: readCommissionScope,
        featureEnabled: readCommissionFeatureEnabled,
        requesterMembership: readCommissionRequesterMembership,
      },
      documents: {
        transport: createDocumentRenderTransport,
        store: createRedisDocumentBytesStore,
        status: createDocumentStatusReader,
      },
    },
    deps.commissionsClock,
  );
}

/** مزوّدات العملاء: الاستيراد مربوط بملفات files الممرّرة من الوحدة بلا سهم استيراد نحوها (073 D-2). */
const customerProviders = (deps: AppDependencies): Provider[] =>
  customersProviders(
    deps.database,
    deps.ids ?? systemUuidV7(),
    deps.customersClock,
    deps.customersTransactionTimeoutMs,
    bindCustomerImportFiles(deps.files?.storage ?? null, documentFileFacts),
  );

@Module({})
class AppModule {
  static forRoot(
    deps: AppDependencies,
    controllers: readonly Type<unknown>[],
    logger: Logger,
    limiter: RateLimiter | null,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [...controllers],
      providers: [
        { provide: READINESS_CHECKS, useValue: deps.readiness.map(singleFlight) },
        { provide: SHUTDOWN, useValue: deps.onShutdown ?? (async () => undefined) },
        ShutdownHook,
        { provide: AUTH_SERVICE, useValue: deps.auth?.service ?? null },
        { provide: PERSONAL_AUTHENTICATION, useValue: deps.personal ?? null },
        // Global guards run in this order (ADR-0003 §4): a verified session unless @Public(); then the company
        // membership and the permission at the target unless @Authenticated(); then the feature flag.
        { provide: APP_GUARD, useClass: SessionGuard },
        ...identityProviders(
          deps.database,
          deps.ids ?? systemUuidV7(),
          deps.redis,
          deps.staff,
          deps.auth?.service.staffUsers.staffCompanyOf,
          deps.memberInvitations,
          deps.staffAccessRoutes === true,
          deps.staffPinClock,
        ),
        ...passwordResetProviders(deps.passwordReset ?? null, deps.corsOrigins ?? []),
        { provide: RATE_LIMITER, useValue: limiter },
        { provide: DATABASE, useValue: deps.database ?? null },
        ...tenancyProviders(deps.database, deps.ids ?? systemUuidV7()),
        ...customerProviders(deps),
        ...catalogProviders(
          deps.database,
          deps.ids ?? systemUuidV7(),
          bindServiceImportFiles(deps.files?.storage ?? null, documentFileFacts),
        ),
        ...ordersProviders(deps.database, deps.ids ?? systemUuidV7(), deps.ordersClock),
        ...commissionBindings(deps),
        ...commissionStatementExportBindings(deps),
        ...commissionOwnEstimateBindings(deps.commissionsClock),
        ...settingsProviders(deps.database, deps.ids ?? systemUuidV7(), deps.redis),
        ...notificationsProviders(deps.database, deps.whatsapp, deps.resend, deps.push),
        ...staffProviders(
          deps.database,
          deps.redis,
          deps.auth?.service.passkeys ?? null,
          deps.files?.storage ?? null,
          deps.employeeCardKey ?? null,
          logger,
          deps.auth?.service.staffUsers ?? null,
          deps.staffAccessRoutes === true,
        ),
        ...filesProviders(deps.database, deps.ids ?? systemUuidV7(), deps.files),
      ],
    };
  }
}

/**
 * Builds the API: NestJS on Fastify, the shared sanitising logger, the error envelope for every error —
 * including the ones Fastify raises before Nest sees the request — `/health` and `/ready` at the root and
 * everything else under `/v1`.
 *
 * @param deps    what the app needs (readiness checks, shutdown); ports arrive with later slices
 * @param options log level, plus test hooks that are never set in production
 * @returns an initialised application, not yet listening
 */
export async function createApp(
  deps: AppDependencies,
  options: AppOptions = {},
): Promise<NestFastifyApplication> {
  const logger = options.logger ?? createLogger('info', { events: API_LOG_EVENTS });
  const controllers = [...API_CONTROLLERS, ...(options.controllers ?? [])];
  assertEveryRouteGuarded(controllers);
  assertAuthenticatedWritesDeclared(controllers, AUTHENTICATED_WRITES);
  const limiter = deps.redis === undefined ? null : createRedisRateLimiter(deps.redis);
  const adapter = buildAdapter(logger, deps.ids ?? systemUuidV7(), deps.trustedProxy ?? []);
  mountWhatsappSecurity(adapter, deps.whatsapp, deps.redis);
  mountStaffAccessGate(adapter.getInstance(), deps.staffAccessRoutes === true);
  mountResendSecurity(adapter, deps.resend, deps.redis);
  mountMemberInvitationGate(adapter.getInstance(), deps.staffAccessRoutes === true);
  adapter.getInstance().addHook('onRoute', (route) => {
    if (
      /^\/v1\/devices\/me\/staff-(otp\/(request|verify)|pin\/sign-in)$/.test(route.url) ||
      /^\/v1\/auth\/password-reset\/otp\/(request|reset)$/.test(route.url)
    )
      route.bodyLimit = 1024;
    // المسارات العامة للتقييم: الحد والترويسات بتتحط قبل أي handler، عشان كل رد يطلع من المسار ده
    // يحملها — حتى الردود اللي بتترفض قبل ما يوصل المسار.
    if (RATING_ROUTE.test(route.url)) {
      const hook = ratingAdmissionHook({
        limiter,
        available: deps.ratingLinksAvailable ?? true,
      });
      if (route.onRequest === undefined) route.onRequest = hook;
      else if (typeof route.onRequest === 'function') route.onRequest = [route.onRequest, hook];
      else route.onRequest = [...route.onRequest, hook];
    }
  });
  if (deps.auth !== undefined) {
    mountAuthRoutes(adapter.getInstance(), deps.auth.service, {
      baseURL: deps.auth.baseURL,
      logger,
    });
  }
  mountRequestLogging(adapter);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(deps, controllers, logger, limiter),
    adapter,
    // abortOnError: false — an initialisation error is thrown to the caller (main.ts releases resources
    // and exits) instead of Nest exiting the process itself.
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );
  enableApiCors(app, {
    trustedOrigins: deps.corsOrigins ?? [],
    requestPolicy: ratingCorsPolicy(deps.ratingPageOrigin ?? ''),
    companyHeader: COMPANY_HEADER,
  });
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  await app.init();
  return app;
}
