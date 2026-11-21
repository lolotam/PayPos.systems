import { CustomerPackagesRoute } from '../../../../_frame/customer-packages-route';

export default async function CustomerPackages({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return <CustomerPackagesRoute customerId={customerId} />;
}
