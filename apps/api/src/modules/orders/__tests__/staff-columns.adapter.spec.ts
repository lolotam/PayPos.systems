import { staffColumnsAdapterCases } from '../../../../test/staff-columns-adapter.cases.ts';
import { staffColumns } from '../persistence/staff-columns.adapter.ts';

// spec 060 57c-1: MY-13, MY-17, MY-18 through this module's StaffColumnsPort adapter.
staffColumnsAdapterCases(staffColumns);
