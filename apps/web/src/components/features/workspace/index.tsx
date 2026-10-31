import { useCallback,useState,useEffect } from 'react';
import { Link,useNavigate } from 'react-router-dom';
import type { ApiEndpoint } from '@brightloop/shared';
import { Plus,Search,ArrowLeft,RefreshCw,Printer,SearchX,Inbox } from 'lucide-react';
import { Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert,AlertDescription,AlertTitle } from '@/components/ui/alert';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs,TabsList,TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/global/data-table';
import { DetailValue } from '@/components/global/detail-value';
import { DataPagination } from '@/components/global/data-pagination';
import { EmptyState } from '@/components/global/empty-state';
import { ListSkeleton } from '@/components/global/list-skeleton';
import { PageHeader } from '@/components/global/page-header';
import { TableSkeleton } from '@/components/global/table-skeleton';
import { ResourceTools } from '@/components/features/resource-tools';
import { RelatedRecords } from '@/components/features/related-records';
import { BillingActions } from '@/components/features/billing-actions';
import { ResourceForm } from '@/components/forms/resource';
import { useAuth } from '@/hooks/auth/use-auth';
import { useWorkspace } from '@/hooks/workspace/use-workspace';
import { useMutation } from '@/hooks/workspace/use-mutation';
import { display,read,titleCase } from '@/lib/display';
import type { ResourceDefinition } from '@/types/workspace';
import { Role } from '@/constants/roles';
import { DEFAULT_LIMIT,PAGE_SIZE_OPTIONS } from '@/constants/pagination';
interface WorkspaceProps { definition: ResourceDefinition; id?: string; mode?: 'new' | 'edit'; }
const ACTIONS: Record<string,ApiEndpoint> = { SEND_QUOTATION:'POST /api/v1/subscriptions/:id/send-quotation', CONFIRM:'POST /api/v1/subscriptions/:id/confirm', ACTIVATE:'POST /api/v1/subscriptions/:id/activate', PAUSE:'POST /api/v1/subscriptions/:id/pause', RESUME:'POST /api/v1/subscriptions/:id/resume', CLOSE:'POST /api/v1/subscriptions/:id/close', RENEW:'POST /api/v1/subscriptions/:id/renew' };
const INVOICE_ACTIONS:Record<string,ApiEndpoint> = { CONFIRM:'POST /api/v1/invoices/:id/confirm', CANCEL:'POST /api/v1/invoices/:id/cancel', SEND:'POST /api/v1/invoices/:id/send' };
const PORTAL_ACTIONS:Record<string,ApiEndpoint> = { PAUSE:'POST /api/v1/portal/subscriptions/:id/pause',RESUME:'POST /api/v1/portal/subscriptions/:id/resume',CLOSE:'POST /api/v1/portal/subscriptions/:id/close',RENEW:'POST /api/v1/portal/subscriptions/:id/renew' };
/** Query keys that do not narrow the result set, so they never count as an active filter. */
const NON_FILTER_KEYS = new Set(['tab','page','limit','sortBy','sortOrder']);
const HIDDEN_DETAIL_KEYS = new Set(['id','allowedActions','costPrice','password']);
/**
 * Scalar fields plus nested records for the details grid. When a nested record is present
 * (`customer`), its flat duplicates (`customerId`, `customerName`) are dropped.
 */
function detailEntries(data:unknown):[string,unknown][]{
 if(data===null||typeof data!=='object'||Array.isArray(data))return [];
 const entries=Object.entries(data).filter(([key,value])=>!Array.isArray(value)&&value!==null&&!HIDDEN_DETAIL_KEYS.has(key));
 const nested=new Set(entries.filter(([,value])=>typeof value==='object').map(([key])=>key));
 // Numeric *Id fields are internal references; text ids such as a customer's taxId stay.
 return entries.filter(([key,value])=>!(key.endsWith('Id')&&typeof value==='number')&&![...nested].some(parent=>key===`${parent}Name`));
}
export function Workspace({definition:d,id,mode}:WorkspaceProps):React.JSX.Element {
 const workspace = useWorkspace(d,id); const {result,params,setFilter} = workspace; const {hasRole,user} = useAuth(); const navigate=useNavigate();
 const [pending,setPending] = useState<{endpoint:ApiEndpoint;label:string;reason?:boolean}|null>(null);const [reason,setReason]=useState('');
 const [audit,setAudit]=useState<unknown>(null);
 const [tab,setTab]=useState(params.get('tab') ?? 'overview');
 const finished = useCallback((data:unknown)=>{setPending(null);setReason('');result.refetch();const next=read(data,'id');if(pending?.label.toLowerCase().includes('renew') && next)navigate(`${d.path}/${String(next)}`);if(pending?.endpoint.startsWith('DELETE'))navigate(d.path);},[result.refetch,pending,d.path,navigate]);
 const mutation=useMutation(finished);
 const allowed=read(result.data,'allowedActions');const actions=Array.isArray(allowed)?allowed.filter((v):v is string=>typeof v==='string'):[];
 const write=hasRole(...d.writeRoles); const data=result.data;
 useEffect(()=>{if(read(data,'status') !== 'RUNNING')return;const timer=setInterval(result.refetch,3000);return()=>clearInterval(timer);},[data,result.refetch]);
 const canEdit=write && d.update && (d.api.includes('invoices') ? actions.includes('EDIT') : true);
 const canDelete=hasRole(...(d.deleteRoles ?? d.writeRoles)) && d.remove && (d.api==='/subscriptions' ? read(data,'status')==='DRAFT':true) && !(d.api==='/staff' && String(user?.id)===id);
 const canCreate=Boolean(write&&d.create);
 const arrays= data && typeof data==='object' ? Object.entries(data).filter(([,v])=>Array.isArray(v) && !v.every(x=>typeof x==='string')) : [];
 const rows=Array.isArray(data)?data:[];
 const columns=d.columns.filter(k=>k!=='costPrice'||hasRole(Role.ADMIN));
 const chooseTab=(value:string):void=>{setTab(value);setFilter('tab',value);};
 const formVisible=workspace.formOpen || mode==='new'||mode==='edit';
 const statusKey=d.api==='/discounts'?'state':'status';
 const hasFilters=[...params.keys()].some(key=>!NON_FILTER_KEYS.has(key)&&params.get(key));
 const limit=Number(params.get('limit')??DEFAULT_LIMIT);
 const recordTitle=String(read(data,'name') ?? read(data,'number') ?? d.singular);
 const detailFields=detailEntries(data);
 const showPagination=Boolean(result.meta&&result.meta.total>PAGE_SIZE_OPTIONS[0]);
 const emptyList=hasFilters
  ?<EmptyState icon={SearchX} title={`No matching ${d.title.toLowerCase()}`} description="Try a different search or clear the filters." actionLabel="Clear filters" onAction={()=>navigate(d.path)}/>
  :<EmptyState icon={Inbox} title={`No ${d.title.toLowerCase()} yet`} description={canCreate?`Create the first ${d.singular.toLowerCase()} to get started.`:`${d.title} will appear here once they are created.`} actionLabel={canCreate?`New ${d.singular.toLowerCase()}`:undefined} onAction={canCreate?()=>workspace.setFormOpen(true):undefined}/>;
 return <div className="flex flex-col gap-6">
 <PageHeader title={id ? recordTitle : d.title} description={id ? d.singular : undefined} actions={<>{id && <Button variant="ghost" onClick={()=>navigate(d.path)}><ArrowLeft className="text-muted-foreground"/>Back</Button>}<Button variant="outline" onClick={result.refetch} disabled={result.isLoading}><RefreshCw className="text-muted-foreground"/>Refresh</Button>{!id&&canCreate&&<Button onClick={()=>workspace.setFormOpen(true)}><Plus/>New {d.singular.toLowerCase()}</Button>}{canEdit&&id&&<Button onClick={()=>workspace.setFormOpen(true)}>Edit</Button>}</>}/>
 {write&&<BillingActions api={d.api} id={id} data={data} refetch={result.refetch}/>}
 {result.error&&<Alert variant="destructive"><AlertTitle>{result.status===404?'Record not found':result.status===403?'Access restricted':'Could not load this page'}</AlertTitle><AlertDescription>{result.error}<Button variant="link" onClick={result.refetch}>Try again</Button></AlertDescription></Alert>}
 {!id && <section className="flex flex-col gap-3">
  <div className="flex flex-wrap items-end gap-3"><div className="relative w-full max-w-xs"><Search className="absolute top-2 left-2.5 size-4 text-muted-foreground"/><Input aria-label="Search records" className="pl-8" placeholder={`Search ${d.title.toLowerCase()}`} value={workspace.search} onChange={e=>workspace.setSearch(e.target.value)}/></div>
  {d.filters?.map(key=><label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">{titleCase(key)}{ /^(is|has|overdue|outstanding|dueFor)/.test(key)?<NativeSelect value={params.get(key)??''} onChange={e=>setFilter(key,e.target.value)}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></NativeSelect>:<Input className="w-36" type={/From$|To$|On$/.test(key)?'date':'text'} value={params.get(key)??''} onChange={e=>setFilter(key,e.target.value)}/>}</label>)}
  {hasFilters&&<Button variant="ghost" onClick={()=>navigate(d.path)}>Clear filters</Button>}</div>
  {d.statuses&&<div className="flex flex-wrap gap-1">{['',...d.statuses].map(status=><Button key={status} size="sm" variant={(params.get(statusKey)??'')===status?'secondary':'ghost'} onClick={()=>setFilter(statusKey,status)}>{status?titleCase(status):'All'}</Button>)}</div>}
  <div className="overflow-hidden rounded-md border">{result.isLoading?<TableSkeleton columns={columns.length} rows={limit}/>:!result.error&&<DataTable rows={rows} columns={columns} onSelect={d.api==='/audit-logs'?setAudit:undefined} base={d.api==='/portal/payments'||d.api==='/audit-logs'?undefined:d.path} empty={emptyList}/>}
  {showPagination&&result.meta&&!result.isLoading&&<DataPagination meta={result.meta} onPageChange={page=>setFilter('page',String(page))} onLimitChange={size=>setFilter('limit',String(size))}/>}</div>
 </section>}
 {id&&(result.isLoading?<section className="rounded-md border p-4"><ListSkeleton variant="grid" rows={9}/></section>:!result.error&&<>
 <div className="flex flex-wrap items-center gap-2">{read(data,'status')!=null&&<Badge variant="outline" className="font-normal">{display(read(data,'status'))}</Badge>}{d.api==='/quotation-templates'&&<Button render={<Link to={`/subscriptions/from-template?templateId=${id}`}/>} nativeButton={false}>Create subscription</Button>}{actions.map(action=>{const endpoint=(d.api.startsWith('/portal')?PORTAL_ACTIONS:d.api==='/invoices'?INVOICE_ACTIONS:ACTIONS)[action];return endpoint?<Button key={action} variant="outline" disabled={mutation.busy} onClick={()=>setPending({endpoint,label:titleCase(action),reason:['CLOSE','CANCEL'].includes(action)})}>{titleCase(action)}</Button>:null;})}{d.api.includes('invoices')&&<Button variant="outline" onClick={()=>navigate(`${d.path}/${id}/print`)}><Printer className="text-muted-foreground"/>Print</Button>}{canDelete&&<Button variant="destructive" onClick={()=>{if(d.remove)setPending({endpoint:d.remove,label:'Delete record'});}}>Delete</Button>}</div>
 {arrays.length>0&&<Tabs value={tab} onValueChange={value=>chooseTab(String(value))}><TabsList variant="line">{['overview',...arrays.map(([key])=>key)].map(key=><TabsTrigger key={key} value={key}>{titleCase(key)}</TabsTrigger>)}</TabsList></Tabs>}
 {tab==='overview'||arrays.length===0?<section className="rounded-md border p-4"><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{detailFields.map(([key,value])=><div key={key} className="flex min-w-0 flex-col gap-1"><dt className="text-xs text-muted-foreground">{titleCase(key)}</dt><dd className="truncate text-sm"><DetailValue name={key} value={value} linkRecords={!d.api.startsWith('/portal')}/></dd></div>)}</dl></section>:arrays.filter(([key])=>key===tab).map(([key,value])=><section key={key} className="overflow-hidden rounded-md border"><DataTable rows={value as unknown[]} columns={Array.isArray(value)&&value[0]&&typeof value[0]==='object'?Object.keys(value[0]).filter(k=>!k.endsWith('Id')).slice(0,8):[]} empty={<EmptyState icon={Inbox} title={`No ${titleCase(key).toLowerCase()}`} description={`This ${d.singular.toLowerCase()} has no ${titleCase(key).toLowerCase()} yet.`}/>}/></section>)}
 {write&&<ResourceTools api={d.api} id={id} data={data} refetch={result.refetch}/>}
 <RelatedRecords api={d.api} id={id}/>
 </>)}
 <Sheet open={audit!==null} onOpenChange={open=>{if(!open)setAudit(null);}}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>Audit event</SheetTitle><SheetDescription>Read-only event metadata</SheetDescription></SheetHeader><pre className="whitespace-pre-wrap break-words p-4 text-xs">{JSON.stringify(read(audit,'metadata')??audit,null,2)}</pre></SheetContent></Sheet>
 <Dialog open={formVisible&&write} onOpenChange={open=>{workspace.setFormOpen(open);if(!open&&mode)navigate(d.path);}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{id?'Edit':'New'} {d.singular.toLowerCase()}</DialogTitle><DialogDescription>Fill in the details below.</DialogDescription></DialogHeader>{formVisible&&<ResourceForm key={id??'new'} definition={d} initial={id?data:undefined} id={id} onSuccess={workspace.saved}/>}</DialogContent></Dialog>
 <Dialog open={Boolean(pending)} onOpenChange={open=>{if(!open)setPending(null);}}><DialogContent><DialogHeader><DialogTitle>{pending?.label}</DialogTitle><DialogDescription>{pending?.endpoint.includes('/cancel')?'A cancelled period is not billed again automatically.':pending?.endpoint.includes('/staff')?'This person will be signed out everywhere.':'Please confirm this action before continuing.'}</DialogDescription></DialogHeader>{pending?.reason&&<Input aria-label="Reason" placeholder="Reason" value={reason} onChange={e=>setReason(e.target.value)}/>} {mutation.error&&<p role="alert" className="text-sm text-destructive">{mutation.error}</p>}<Button disabled={mutation.busy||(pending?.reason&&!d.api.startsWith('/portal')&&!reason.trim())} onClick={()=>{if(pending)void mutation.submit(pending.endpoint,pending.reason?{reason}: {},id);}}>{mutation.busy?'Working…':'Confirm'}</Button></DialogContent></Dialog>
 </div>;
}
