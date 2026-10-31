import { useState } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { useResource } from '@/hooks/common/use-resource';
import { useDebounce } from '@/hooks/common/use-debounce';
import { read } from '@/lib/display';
interface EntitySelectProps { resource: string; value: string; onChange: (value: string) => void; parentId?:number; }
export function EntitySelect({resource,value,onChange,parentId}: EntitySelectProps): React.JSX.Element {
 const [search,setSearch] = useState(''); const debounced = useDebounce(search);
 const names: Record<string,string> = {customer:'customers',product:'products',plan:'plans',paymentTerm:'payment-terms',template:'quotation-templates',subscription:'subscriptions',invoice:'invoices',tax:'taxes',discount:'discounts'};
 const path = resource==='variant' ? `/products/${parentId}/variants` : `/${names[resource] ?? resource}`;
 const query = new URLSearchParams({limit:'100'});if(debounced&&resource!=='variant')query.set('search',debounced);if(['product','plan','tax','paymentTerm','template','discount','variant'].includes(resource))query.set('isActive','true');
 const result = useResource<unknown[]>(path,query.toString(),resource!=='variant'||Boolean(parentId));
 return <div className="space-y-1"><Input aria-label={`Search ${resource}`} placeholder={`Search ${resource}…`} value={search} onChange={e=>setSearch(e.target.value)}/><NativeSelect aria-label={`Choose ${resource}`} className="w-full" value={value} onChange={e=>onChange(e.target.value)}><option value="">{result.isLoading ? 'Loading…' : `Choose ${resource}`}</option>{value && !result.data?.some(row=>String(read(row,'id'))===value) && <option value={value}>Selected #{value}</option>}{result.data?.map(row=><option key={String(read(row,'id'))} value={String(read(row,'id'))}>{String(read(row,'name') ?? read(row,'number') ?? `${read(row,'attribute')}: ${read(row,'value')}`)}</option>)}</NativeSelect>{result.error && <p className="text-xs text-destructive">{result.error}</p>}</div>;
}
