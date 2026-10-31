import { useCallback,useState,useEffect } from 'react';
import { Link,useNavigate } from 'react-router-dom';
import type { ApiEndpoint } from '@brightloop/shared';
import { Plus,Search,ArrowLeft,RefreshCw,Printer,ChevronLeft,ChevronRight } from 'lucide-react';
import { Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card,CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert,AlertDescription,AlertTitle } from '@/components/ui/alert';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { DataTable } from '@/components/global/data-table';
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
interface WorkspaceProps { definition: ResourceDefinition; id?: string; mode?: 'new' | 'edit'; }
const ACTIONS: Record<string,ApiEndpoint> = { SEND_QUOTATION:'POST /api/v1/subscriptions/:id/send-quotation', CONFIRM:'POST /api/v1/subscriptions/:id/confirm', ACTIVATE:'POST /api/v1/subscriptions/:id/activate', PAUSE:'POST /api/v1/subscriptions/:id/pause', RESUME:'POST /api/v1/subscriptions/:id/resume', CLOSE:'POST /api/v1/subscriptions/:id/close', RENEW:'POST /api/v1/subscriptions/:id/renew' };
const INVOICE_ACTIONS:Record<string,ApiEndpoint> = { CONFIRM:'POST /api/v1/invoices/:id/confirm', CANCEL:'POST /api/v1/invoices/:id/cancel', SEND:'POST /api/v1/invoices/:id/send' };
const PORTAL_ACTIONS:Record<string,ApiEndpoint> = { PAUSE:'POST /api/v1/portal/subscriptions/:id/pause',RESUME:'POST /api/v1/portal/subscriptions/:id/resume',CLOSE:'POST /api/v1/portal/subscriptions/:id/close',RENEW:'POST /api/v1/portal/subscriptions/:id/renew' };
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
 const arrays= data && typeof data==='object' ? Object.entries(data).filter(([,v])=>Array.isArray(v) && !v.every(x=>typeof x==='string')) : [];
 const rows=Array.isArray(data)?data:[];
 const columns=d.columns.filter(k=>k!=='costPrice'||hasRole(Role.ADMIN));
 const chooseTab=(value:string):void=>{setTab(value);setFilter('tab',value);};
 const formVisible=workspace.formOpen || mode==='new'||mode==='edit';
 return <div className="space-y-6">
 <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">{id ? d.title : 'Workspace'}</p><h1 className="text-3xl font-semibold tracking-tight">{id ? String(read(data,'name') ?? read(data,'number') ?? d.singular) : d.title}</h1><p className="mt-2 text-sm text-muted-foreground">{id ? 'Details, activity, and available actions.' : `Manage your ${d.title.toLowerCase()} in one place.`}</p></div><div className="flex gap-2">{id && <Button variant="outline" onClick={()=>navigate(d.path)}><ArrowLeft/>Back</Button>}<Button variant="outline" onClick={result.refetch}><RefreshCw className={result.isLoading?'animate-spin':''}/>Refresh</Button>{!id&&write&&d.create&&<Button onClick={()=>workspace.setFormOpen(true)}><Plus/>New {d.singular.toLowerCase()}</Button>}{canEdit&&id&&<Button onClick={()=>workspace.setFormOpen(true)}>Edit</Button>}</div></header>
 {write&&<BillingActions api={d.api} id={id} data={data} refetch={result.refetch}/>}
 {result.error&&<Alert variant="destructive"><AlertTitle>{result.status===404?'Record not found':result.status===403?'Access restricted':'Could not load this page'}</AlertTitle><AlertDescription>{result.error}<Button variant="link" onClick={result.refetch}>Try again</Button></AlertDescription></Alert>}
 {!id && <Card><CardContent className="space-y-4 p-5"><div className="flex flex-wrap gap-3"><div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input aria-label="Search records" className="pl-9" placeholder={`Search ${d.title.toLowerCase()}…`} value={workspace.search} onChange={e=>workspace.setSearch(e.target.value)}/></div><NativeSelect aria-label="Rows per page" value={params.get('limit')??'10'} onChange={e=>setFilter('limit',e.target.value)}>{[10,25,50,100].map(n=><option key={n} value={n}>{n} per page</option>)}</NativeSelect><Button variant="ghost" onClick={()=>navigate(d.path)}>Reset filters</Button></div>
 {d.statuses&&<div className="flex flex-wrap gap-2">{['',...d.statuses].map(status=><Button key={status} size="sm" variant={(params.get(d.api==='/discounts'?'state':'status')??'')===status?'default':'outline'} onClick={()=>setFilter(d.api==='/discounts'?'state':'status',status)}>{status?titleCase(status):'All'}</Button>)}</div>}
 <div className="flex flex-wrap gap-3">{d.filters?.map(key=><label key={key} className="grid gap-1 text-xs text-muted-foreground">{titleCase(key)}{ /^(is|has|overdue|outstanding|dueFor)/.test(key)?<NativeSelect value={params.get(key)??''} onChange={e=>setFilter(key,e.target.value)}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></NativeSelect>:<Input className="w-36" type={/From$|To$|On$/.test(key)?'date':'text'} value={params.get(key)??''} onChange={e=>setFilter(key,e.target.value)}/>}</label>)}</div></CardContent></Card>}
 {result.isLoading?<div className="space-y-3">{[1,2,3,4].map(n=><Skeleton key={n} className="h-14 w-full"/>)}</div>: !result.error && (!id?<Card className="overflow-hidden"><DataTable rows={rows} columns={columns} onSelect={d.api==='/audit-logs'?setAudit:undefined} base={d.api==='/portal/payments'||d.api==='/audit-logs'?undefined:d.path}/><div className="flex items-center justify-between border-t p-4 text-sm text-muted-foreground"><span>{result.meta?.total??rows.length} records · Page {result.meta?.page??1} of {result.meta?.totalPages||1}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!result.meta?.hasPrev} onClick={()=>setFilter('page',String((result.meta?.page??1)-1))}><ChevronLeft/>Previous</Button><Button size="sm" variant="outline" disabled={!result.meta?.hasNext} onClick={()=>setFilter('page',String((result.meta?.page??1)+1))}>Next<ChevronRight/></Button></div></div></Card>:<>
 <div className="flex flex-wrap gap-2">{d.api==='/quotation-templates'&&<Link to={`/subscriptions/from-template?templateId=${id}`}><Button>Create subscription</Button></Link>}{read(data,'status')!=null&&<Badge>{display(read(data,'status'))}</Badge>}{actions.map(action=>{const endpoint=(d.api.startsWith('/portal')?PORTAL_ACTIONS:d.api==='/invoices'?INVOICE_ACTIONS:ACTIONS)[action];return endpoint?<Button key={action} variant="outline" disabled={mutation.busy} onClick={()=>setPending({endpoint,label:titleCase(action),reason:['CLOSE','CANCEL'].includes(action)})}>{titleCase(action)}</Button>:null;})}{d.api.includes('invoices')&&<Button variant="outline" onClick={()=>navigate(`${d.path}/${id}/print`)}><Printer/>Print invoice</Button>}{canDelete&&<Button variant="destructive" onClick={()=>{if(d.remove)setPending({endpoint:d.remove,label:'Delete record'});}}>Delete</Button>}</div>
 <nav className="flex gap-5 overflow-x-auto border-b">{['overview',...arrays.map(([key])=>key)].map(key=><button key={key} className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm ${tab===key?'border-primary font-medium':'border-transparent text-muted-foreground'}`} onClick={()=>chooseTab(key)}>{titleCase(key)}</button>)}</nav>
 {tab==='overview'?<Card><CardContent className="grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-3">{data!==null&&typeof data==='object'&&Object.entries(data).filter(([key,value])=>!Array.isArray(value)&&value!==null&&!['allowedActions','costPrice','password'].includes(key)).map(([key,value])=><div key={key}><dt className="text-xs text-muted-foreground">{titleCase(key)}</dt><dd className="mt-1 text-sm font-medium">{display(value,key)}</dd></div>)}</CardContent></Card>:arrays.filter(([key])=>key===tab).map(([key,value])=><Card key={key}><DataTable rows={value as unknown[]} columns={Array.isArray(value)&&value[0]&&typeof value[0]==='object'?Object.keys(value[0]).filter(k=>!k.endsWith('Id')).slice(0,8):[]}/></Card>)}
 {id&&write&&<ResourceTools api={d.api} id={id} data={data} refetch={result.refetch}/>}
 {id&&<RelatedRecords api={d.api} id={id}/>}
 </>)}
 <Sheet open={audit!==null} onOpenChange={open=>{if(!open)setAudit(null);}}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>Audit event</SheetTitle><SheetDescription>Read-only event metadata</SheetDescription></SheetHeader><pre className="whitespace-pre-wrap break-words p-5 text-xs">{JSON.stringify(read(audit,'metadata')??audit,null,2)}</pre></SheetContent></Sheet>
 <Dialog open={formVisible&&write} onOpenChange={open=>{workspace.setFormOpen(open);if(!open&&mode)navigate(d.path);}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{id?'Edit':'New'} {d.singular.toLowerCase()}</DialogTitle><DialogDescription>Enter the details below. Changes are saved to your workspace.</DialogDescription></DialogHeader>{formVisible&&<ResourceForm key={id??'new'} definition={d} initial={id?data:undefined} id={id} onSuccess={workspace.saved}/>}</DialogContent></Dialog>
 <Dialog open={Boolean(pending)} onOpenChange={open=>{if(!open)setPending(null);}}><DialogContent><DialogHeader><DialogTitle>{pending?.label}</DialogTitle><DialogDescription>{pending?.endpoint.includes('/cancel')?'A cancelled period is not billed again automatically.':pending?.endpoint.includes('/staff')?'This person will be signed out everywhere.':'Please confirm this action before continuing.'}</DialogDescription></DialogHeader>{pending?.reason&&<Input aria-label="Reason" placeholder="Reason" value={reason} onChange={e=>setReason(e.target.value)}/>} {mutation.error&&<p role="alert" className="text-destructive">{mutation.error}</p>}<Button disabled={mutation.busy||(pending?.reason&&!d.api.startsWith('/portal')&&!reason.trim())} onClick={()=>{if(pending)void mutation.submit(pending.endpoint,pending.reason?{reason}: {},id);}}>{mutation.busy?'Working…':'Confirm'}</Button></DialogContent></Dialog>
 </div>;
}
