import { useResource } from '../api/api-context';
import type { CustomerDto, PlanDto } from '../api/types';
import { fetchAll } from './shared';

export interface Directory {
  plans: PlanDto[];
  customers: Map<string, CustomerDto>;
}

/** The plan catalog and every customer, for pages that show names next to ids. */
export function useDirectory() {
  return useResource<Directory>('directory', async (api) => {
    const [plans, customers] = await Promise.all([api.plans(), fetchAll((page) => api.customers(page))]);
    return { plans, customers: new Map(customers.map((customer) => [customer.id, customer])) };
  });
}
