import { useState,useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ResourceDefinition } from '@/types/workspace';
import { STAFF_ROLES } from '@/constants/roles';
import { paymentSchema } from '@/components/forms/resource/schema';
import { ResourceForm } from '@/components/forms/resource';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/global/table-skeleton';
import { EntitySelect } from '@/components/global/entity-select';
import { DataTable } from '@/components/global/data-table';
import { useInvoiceGeneration } from '@/hooks/invoices/use-invoice-generation';
import { read } from '@/lib/display';
import { formatPaise } from '@/lib/format';
import { todayInBusinessTz } from '@/lib/dates';
interface BillingActionsProps {api:string;id?:string;data:unknown;refetch:()=>void;}
const paymentDefinition:ResourceDefinition={title:'Payments',singular:'Payment',path:'/payments',api:'/payments',columns:[],fields:[{key:'invoiceId',label:'Invoice',type:'number'},{key:'amount',label:'Amount (₹)',type:'money'},{key:'method',label:'Payment method',options:['CASH','BANK_TRANSFER','CARD','UPI','CHEQUE','ONLINE','OTHER']},{key:'paymentDate',label:'Payment date',type:'date'},{key:'reference',label:'Reference'},{key:'note',label:'Note',type:'textarea'}],schema:paymentSchema,create:'POST /api/v1/payments',writeRoles:STAFF_ROLES};
function GenerateInvoice({id,onSuccess}:{id?:string;onSuccess:(data:unknown)=>void}):React.JSX.Element {
 const flow=useInvoiceGeneration(onSuccess,id);
 return <div className="flex flex-col gap-4"><Label>Subscription</Label><EntitySelect resource="subscription" value={flow.subscription} onChange={flow.setSubscription}/><Label htmlFor="as-of">Bill through</Label><Input id="as-of" type="date" value={flow.asOf} onChange={e=>flow.setAsOf(e.target.value)}/><label className="flex gap-2 text-sm"><input type="checkbox" checked={flow.autoConfirm} onChange={e=>flow.setAutoConfirm(e.target.checked)}/>Automatically confirm</label>{flow.preview.isLoading?<div className="rounded-md border"><TableSkeleton columns={5} rows={2}/></div>:flow.preview.error?<p role="alert" className="text-sm text-destructive">{flow.preview.error}</p>:flow.preview.data&&<><div className="overflow-hidden rounded-md border"><DataTable rows={flow.preview.data.lines} columns={['description','quantity','unitPrice','taxAmount','amount']}/></div><p className="text-right text-sm font-medium tabular-nums">Total {formatPaise(flow.preview.data.total)}</p></>}{flow.mutation.error&&<p role="alert" className="text-sm text-destructive">{flow.mutation.error}</p>}<Button disabled={!flow.preview.data||flow.mutation.busy} onClick={flow.generate}>{flow.mutation.busy?'Generating…':'Generate invoice'}</Button></div>;
}
export function BillingActions({api,id,data,refetch}:BillingActionsProps):React.JSX.Element {
 const [mode,setMode]=useState<'invoice'|'payment'|null>(null);const navigate=useNavigate();
 const done=useCallback((value:unknown)=>{setMode(null);refetch();if(mode==='invoice'&&read(value,'id'))navigate(`/invoices/${String(read(value,'id'))}`);},[mode,refetch,navigate]);
 const actions=read(data,'allowedActions');const payable=Array.isArray(actions)&&actions.includes('RECORD_PAYMENT');
 return <><div className="flex gap-2 empty:hidden">{((api==='/invoices'&&!id)||(api==='/subscriptions'&&read(data,'status')==='ACTIVE'))&&<Button variant="outline" onClick={()=>setMode('invoice')}>Generate invoice</Button>}{api==='/invoices'&&id&&payable&&<Button onClick={()=>setMode('payment')}>Record payment</Button>}</div><Dialog open={mode!==null} onOpenChange={open=>{if(!open)setMode(null);}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{mode==='invoice'?'Generate invoice':'Record payment'}</DialogTitle><DialogDescription>{mode==='invoice'?'Preview server-calculated totals before generating.':'Record a payment received against this invoice.'}</DialogDescription></DialogHeader>{mode==='invoice'?<GenerateInvoice id={api==='/subscriptions'?id:undefined} onSuccess={done}/>:mode==='payment'?<ResourceForm definition={paymentDefinition} initial={{invoiceId:Number(id),amount:read(data,'amountDue'),paymentDate:todayInBusinessTz(),method:'BANK_TRANSFER'}} onSuccess={done}/>:null}</DialogContent></Dialog></>;
}
