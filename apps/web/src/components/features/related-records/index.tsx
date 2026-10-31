import { Link } from 'react-router-dom';
import { useResource } from '@/hooks/common/use-resource';
import { Card,CardHeader,CardTitle,CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/global/data-table';
interface RelatedRecordsProps {api:string;id:string;}
function RelatedTable({title,path,query,columns,base}:{title:string;path:string;query:string;columns:string[];base?:string}):React.JSX.Element {
 const result=useResource<unknown[]>(path,query);return <Card><CardHeader className="flex-row justify-between"><CardTitle>{title}</CardTitle>{base&&<Link to={`${base}?${query}`} className="text-sm hover:underline">View all →</Link>}</CardHeader><CardContent>{result.isLoading?<Skeleton className="h-32"/>:result.error?<p role="alert" className="text-sm text-destructive">{result.error}</p>:<DataTable rows={result.data??[]} columns={columns} base={base}/>}</CardContent></Card>;
}
export function RelatedRecords({api,id}:RelatedRecordsProps):React.JSX.Element {
 return <div className="space-y-5">{api==='/customers'&&<>{[{title:'Subscriptions',path:'/subscriptions',columns:['number','planName','status','total']},{title:'Invoices',path:'/invoices',columns:['number','dueDate','total','amountDue']},{title:'Payments',path:'/payments',columns:['invoiceNumber','amount','paymentDate']}].map(block=><RelatedTable key={block.path} {...block} base={block.path} query={`customerId=${id}&limit=5`}/>)}</>}{api==='/billing-runs'&&<RelatedTable title="Run items" path={`/billing-runs/${id}/items`} query="limit=25" columns={['subscriptionNumber','invoiceNumber','status','message']}/>}{api==='/discounts'&&<RelatedTable title="Discount usage" path={`/discounts/${id}/usages`} query="limit=10" columns={['invoiceNumber','subscriptionNumber','amount','createdAt']}/>}</div>;
}
