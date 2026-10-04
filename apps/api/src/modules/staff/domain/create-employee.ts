// قواعد إنشاء الموظف مشتركة بين API والوظيفة داخل نفس سياق staff، دون أي بنية تحتية.
export {
  EmployeeCreationError,
  validateEmployeeBranch,
  validateEmployeeCreation,
  type EmployeeRecord,
  type EmployeeCreationContext,
} from '@pospay/domain';
