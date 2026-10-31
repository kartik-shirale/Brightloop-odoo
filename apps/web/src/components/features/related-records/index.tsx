import { Link } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { useResource } from '@/hooks/common/use-resource';
import { DataTable } from '@/components/global/data-table';
import { EmptyState } from '@/components/global/empty-state';
import { TableSkeleton } from '@/components/global/table-skeleton';
interface RelatedRecordsProps {api:string;id:string;}
interface RelatedTableProps {title:string;path:string;query:string;columns:string[];base?:string;limit:number}
function RelatedTable({title,path,query,columns,base,limit}:RelatedTableProps):React.JSX.Element {
 const result=useResource<unknown[]>(path,query);
 return <section className="flex flex-col gap-3"><div className="flex items-center justify-between"><h2 className="text-sm font-medium">{title}</h2>{base&&<Link to={`${base}?${query}`} className="text-xs text-muted-foreground hover:underline">View all</Link>}</div><div className="overflow-hidden rounded-md border">{result.isLoading?<TableSkeleton columns={columns.length} rows={limit}/>:result.error?<p role="alert" className="p-4 text-sm text-destructive">{result.error}</p>:<DataTable rows={result.data??[]} columns={columns} base={base} empty={<EmptyState icon={Inbox} title={`No ${title.toLowerCase()}`} description={`Nothing has been recorded here yet.`}/>}/>}</div></section>;
}
export function RelatedRecords({api,id}:RelatedRecordsProps):React.JSX.Element {
 return <>{api==='/customers'&&[{title:'Subscriptions',path:'/subscriptions',columns:['number','planName','status','total']},{title:'Invoices',path:'/invoices',columns:['number','dueDate','total','amountDue']},{title:'Payments',path:'/payments',columns:['invoiceNumber','amount','paymentDate']}].map(block=><RelatedTable key={block.path} {...block} base={block.path} query={`customerId=${id}&limit=5`} limit={5}/>)}{api==='/billing-runs'&&<RelatedTable title="Run items" path={`/billing-runs/${id}/items`} query="limit=25" limit={8} columns={['subscriptionNumber','invoiceNumber','status','message']}/>}{api==='/discounts'&&<RelatedTable title="Discount usage" path={`/discounts/${id}/usages`} query="limit=10" limit={8} columns={['invoiceNumber','subscriptionNumber','amount','createdAt']}/>}</>;
}
