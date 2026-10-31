import { useCallback, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useResource } from '@/hooks/common/use-resource';
import { useDebounce } from '@/hooks/common/use-debounce';
import type { ResourceDefinition } from '@/types/workspace';
export function useWorkspace(definition: ResourceDefinition, id?: string): { result: ReturnType<typeof useResource<unknown>>; params: URLSearchParams; search: string; setSearch: (value:string)=>void; setFilter: (key:string,value:string)=>void; formOpen:boolean; setFormOpen:(value:boolean)=>void; saved:(value:unknown)=>void } {
 const [params,setParams] = useSearchParams(); const navigate = useNavigate();
 const search = params.get('search') ?? ''; const debounced = useDebounce(search);
 const [formOpen,setFormOpen] = useState(false);
 const setFilter = useCallback((key:string,value:string)=>{setParams(previous=>{const next=new URLSearchParams(previous); if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.set('page','1');return next;});},[setParams]);
 const setSearch = useCallback((value:string)=>setFilter('search',value),[setFilter]);
 const query = new URLSearchParams(params); query.delete('tab'); if(debounced)query.set('search',debounced);else query.delete('search'); if(!id){if(definition.api==='/portal/invoices'&&!query.has('status'))query.set('status','CONFIRMED,PAID');if(!query.has('limit'))query.set('limit','10'); if(!query.has('page'))query.set('page','1');}
 const result = useResource<unknown>(`${definition.api}${id ? `/${id}` : ''}`,id ? '' : query.toString());
 const saved = useCallback(()=>{setFormOpen(false);result.refetch();if(!id)navigate(definition.path);},[result.refetch,id,navigate,definition.path]);
 return {result,params,search,setSearch,setFilter,formOpen,setFormOpen,saved};
}
