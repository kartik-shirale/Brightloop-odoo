import { Link,useLocation,useNavigate,useSearchParams } from 'react-router-dom';
import { BarChart3,CalendarClock,CircleCheck,SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Alert,AlertDescription } from '@/components/ui/alert';
import { DataTable } from '@/components/global/data-table';
import { DataPagination } from '@/components/global/data-pagination';
import { EmptyState } from '@/components/global/empty-state';
import { PageHeader } from '@/components/global/page-header';
import { StatsSkeleton } from '@/components/global/stats-skeleton';
import { TableSkeleton } from '@/components/global/table-skeleton';
import { useResource } from '@/hooks/common/use-resource';
import { display,titleCase } from '@/lib/display';
import { PAGE_SIZE_OPTIONS } from '@/constants/pagination';
import { ROUTES } from '@/constants/routes';
const reports = {summary:'/reports/summary',revenue:'/reports/revenue/timeseries',payments:'/reports/payments/summary',overdue:'/reports/invoices/overdue',aging:'/reports/aging',renewals:'/reports/subscriptions/expiring'};
type ReportName = keyof typeof reports;
const LIST_REPORTS = new Set<ReportName>(['revenue','overdue','renewals']);
const EMPTY = {
 revenue:{icon:BarChart3,title:'No revenue in this range',description:'Pick a wider date range to see earlier months.'},
 overdue:{icon:CircleCheck,title:'No overdue invoices',description:'Every confirmed invoice is paid or not yet due.'},
 renewals:{icon:CalendarClock,title:'No renewals in this window',description:'Increase the number of days to look further ahead.'},
} as const;
type Row = Record<string,unknown>;
const isRecord=(value:unknown):value is Row=>typeof value==='object'&&value!==null&&!Array.isArray(value);
/** A nested breakdown becomes table rows: { name, ...fields } for objects, { name, count } for numbers. */
function toRows(value:Row):Row[]{return Object.entries(value).map(([name,item])=>isRecord(item)?{name:titleCase(name),...item}:{name:titleCase(name),count:item});}
export function Reports():React.JSX.Element {
 const location=useLocation();const navigate=useNavigate();const [params,setParams]=useSearchParams();
 const section=location.pathname.split('/').at(-1)??'summary';const name=(section==='reports'?'summary':section) as ReportName;const endpoint=reports[name]??reports.summary;
 const result=useResource<unknown>(endpoint,params.toString());
 const set=(key:string,value:string):void=>{setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.delete('page');return next;});};
 const rows=Array.isArray(result.data)?result.data:[];const fields=name==='aging'?['customerId']:name==='renewals'?['withinDays','planId','customerId']:name==='overdue'?['minDaysOverdue','minAmount','dueFrom','dueTo','customerId']:['from','to'];
 const data=isRecord(result.data)?result.data:null;
 const scalars=data?Object.entries(data).filter(([,value])=>!isRecord(value)&&!Array.isArray(value)):[];
 const tables=data?Object.entries(data).filter(([,value])=>isRecord(value)||Array.isArray(value)):[];
 const allNested=data!==null&&scalars.length===0&&tables.every(([,value])=>isRecord(value));
 const hasFilters=[...params.keys()].some(key=>!['page','limit'].includes(key));
 const empty=name in EMPTY?EMPTY[name as keyof typeof EMPTY]:{icon:SearchX,title:'No data for this range',description:'Try a different date range.'};
 return <>
 <PageHeader title="Reports"/>
 <nav className="flex flex-wrap gap-1">{(Object.keys(reports) as ReportName[]).map(key=><Button key={key} size="sm" variant={name===key?'secondary':'ghost'} render={<Link to={key==='summary'?ROUTES.REPORTS.SUMMARY:`${ROUTES.REPORTS.SUMMARY}/${key}`}/>} nativeButton={false}>{titleCase(key)}</Button>)}</nav>
 <div className="flex flex-wrap items-end gap-3">{fields.map(key=><label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">{titleCase(key)}<Input className="w-40" type={['from','to','dueFrom','dueTo'].includes(key)?'date':'number'} value={params.get(key)??''} onChange={e=>set(key,e.target.value)}/></label>)}{name==='revenue'&&<label className="flex flex-col gap-1 text-xs text-muted-foreground">Group by<NativeSelect value={params.get('interval')??'month'} onChange={e=>set('interval',e.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></NativeSelect></label>}{hasFilters&&<Button variant="ghost" onClick={()=>navigate(location.pathname)}>Clear filters</Button>}</div>
 {result.error?<Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>
 :LIST_REPORTS.has(name)?<div className="overflow-hidden rounded-md border">{result.isLoading?<TableSkeleton columns={6} rows={Number(params.get('limit')??8)}/>:<DataTable rows={rows} columns={rows[0]?Object.keys(rows[0]).slice(0,9):[]} empty={<EmptyState {...empty} actionLabel={hasFilters?'Clear filters':undefined} onAction={hasFilters?()=>navigate(location.pathname):undefined}/>}/>}{!result.isLoading&&result.meta&&result.meta.total>PAGE_SIZE_OPTIONS[0]&&<DataPagination meta={result.meta} onPageChange={page=>set('page',String(page))} onLimitChange={size=>set('limit',String(size))}/>}</div>
 :result.isLoading?<StatsSkeleton count={4}/>
 :!data?<div className="rounded-md border"><EmptyState {...empty} actionLabel={hasFilters?'Clear filters':undefined} onAction={hasFilters?()=>navigate(location.pathname):undefined}/></div>
 :allNested?<div className="overflow-hidden rounded-md border"><DataTable rows={toRows(data)} columns={Object.keys(toRows(data)[0]??{})}/></div>
 :<>{scalars.length>0&&<dl className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-4">{scalars.map(([key,value])=><div key={key} className="flex flex-col gap-1 bg-background p-4"><dt className="text-xs text-muted-foreground">{titleCase(key)}</dt><dd className="text-xl font-medium tabular-nums">{display(value,key)}</dd></div>)}</dl>}
 {tables.map(([key,value])=>{const tableRows=Array.isArray(value)?value:toRows(value as Row);return <section key={key} className="flex flex-col gap-3"><h2 className="text-sm font-medium">{titleCase(key)}</h2><div className="overflow-hidden rounded-md border"><DataTable rows={tableRows} columns={tableRows[0]&&typeof tableRows[0]==='object'?Object.keys(tableRows[0]):[]}/></div></section>;})}</>}
 </>;
}
