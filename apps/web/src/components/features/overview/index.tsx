import { Link,useNavigate } from 'react-router-dom';
import { CalendarClock,CircleCheck,CreditCard,FileText,LineChart as LineChartIcon,Plus,RefreshCw,Repeat,UserPlus } from 'lucide-react';
import type { ReportSummaryDto,PortalSummaryDto,RevenueTimeseriesDto } from '@brightloop/shared';
import { Button } from '@/components/ui/button';
import { Alert,AlertDescription } from '@/components/ui/alert';
import { ChartContainer,ChartLegend,ChartLegendContent,ChartTooltip,ChartTooltipContent,type ChartConfig } from '@/components/ui/chart';
import { CartesianGrid,Line,LineChart,XAxis } from 'recharts';
import { useResource } from '@/hooks/common/use-resource';
import { formatPaise } from '@/lib/format';
import { DataTable } from '@/components/global/data-table';
import { EmptyState } from '@/components/global/empty-state';
import { PageHeader } from '@/components/global/page-header';
import { StatRow,type Stat } from '@/components/global/stat-row';
import { StatsSkeleton } from '@/components/global/stats-skeleton';
import { ChartSkeleton } from '@/components/global/chart-skeleton';
import { TableSkeleton } from '@/components/global/table-skeleton';
import { ROUTES } from '@/constants/routes';
interface OverviewProps {portal?:boolean;}
const revenueChart={invoiced:{label:'Invoiced',color:'var(--chart-1)'},received:{label:'Received',color:'var(--chart-2)'}} satisfies ChartConfig;
const QUICK_ACTIONS=[{href:ROUTES.CUSTOMERS.NEW,label:'Add a customer',icon:UserPlus},{href:ROUTES.BILLING_RUNS.LIST,label:'Run billing',icon:RefreshCw},{href:ROUTES.INVOICES.LIST,label:'Record a payment',icon:CreditCard}] as const;
const monthLabel=(value:unknown):string=>new Intl.DateTimeFormat('en-IN',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(String(value)));
const money=(value:number|undefined):string=>value===undefined?'—':formatPaise(value);
export function Overview({portal=false}:OverviewProps):React.JSX.Element {
 const navigate=useNavigate();
 const summary=useResource<ReportSummaryDto & PortalSummaryDto>(portal?'/portal/summary':'/reports/summary');
 const revenue=useResource<RevenueTimeseriesDto>('/reports/revenue/timeseries','interval=month',!portal);
 const overdue=useResource<unknown[]>(portal?'/portal/invoices':'/reports/invoices/overdue','limit=5');
 const expiring=useResource<unknown[]>(portal?'/portal/subscriptions':'/reports/subscriptions/expiring','limit=5');
 const s=summary.data;
 const stats:Stat[]=portal
  ?[{label:'Active subscriptions',value:s?.activeSubscriptions??'—'},{label:'Outstanding balance',value:money(s?.outstandingAmount)},{label:'Overdue invoices',value:s?.overdueCount??'—'},{label:'Overdue amount',value:money(s?.overdueAmount)}]
  :[{label:'Active subscriptions',value:s?.activeSubscriptions??'—'},{label:'Monthly recurring revenue',value:money(s?.mrr)},{label:'Revenue received',value:money(s?.revenueReceived),meta:'This month'},{label:'Outstanding balance',value:money(s?.outstandingAmount)}];
 const blocks=[
  {title:portal?'Recent invoices':'Overdue invoices',result:overdue,path:portal?ROUTES.PORTAL_INVOICES.LIST:ROUTES.INVOICES.LIST,columns:['number','customerName','amountDue'],empty:portal?{icon:FileText,title:'No invoices yet',description:'Invoices appear here once they are issued.'}:{icon:CircleCheck,title:'No overdue invoices',description:'Every confirmed invoice is paid or not yet due.'}},
  {title:portal?'Your subscriptions':'Upcoming renewals',result:expiring,path:portal?ROUTES.PORTAL_SUBSCRIPTIONS.LIST:ROUTES.SUBSCRIPTIONS.LIST,columns:['number','planName','expiryDate'],empty:portal?{icon:Repeat,title:'No subscriptions yet',description:'Your subscriptions appear here once they start.'}:{icon:CalendarClock,title:'No renewals coming up',description:'Subscriptions expiring in the next 30 days appear here.'}},
 ];
 return <>
 <PageHeader title={portal?'Your account':'Overview'} actions={!portal&&<Button render={<Link to={ROUTES.SUBSCRIPTIONS.NEW}/>} nativeButton={false}><Plus/>New subscription</Button>}/>
 {summary.error&&<Alert variant="destructive"><AlertDescription>{summary.error}<Button variant="link" onClick={summary.refetch}>Retry</Button></AlertDescription></Alert>}
 {summary.isLoading?<StatsSkeleton count={stats.length}/>:<StatRow stats={stats}/>}
 {!portal&&<div className="grid gap-6 lg:grid-cols-3">
  <section className="flex flex-col gap-3 lg:col-span-2"><div><h2 className="text-sm font-medium">Revenue</h2><p className="text-xs text-muted-foreground">Invoiced and received per month</p></div>
  {revenue.isLoading?<ChartSkeleton/>:revenue.error?<p role="alert" className="text-sm text-destructive">{revenue.error}</p>:!revenue.data?.length?<div className="flex h-60 items-center justify-center rounded-md border"><EmptyState icon={LineChartIcon} title="No revenue yet" description="Revenue appears here after the first invoice is confirmed." actionLabel="Run billing" onAction={()=>navigate(ROUTES.BILLING_RUNS.LIST)}/></div>
  :<ChartContainer config={revenueChart} className="h-60 w-full"><LineChart accessibilityLayer data={revenue.data} margin={{left:8,right:8}}><CartesianGrid vertical={false}/><XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={monthLabel}/><ChartTooltip content={<ChartTooltipContent labelFormatter={monthLabel} formatter={value=>formatPaise(Number(value))}/>}/><ChartLegend content={<ChartLegendContent/>}/><Line dataKey="invoiced" type="monotone" stroke="var(--color-invoiced)" strokeWidth={1.5} dot={false} isAnimationActive={false}/><Line dataKey="received" type="monotone" stroke="var(--color-received)" strokeWidth={1.5} dot={false} isAnimationActive={false}/></LineChart></ChartContainer>}</section>
  <section className="flex flex-col gap-3"><h2 className="text-sm font-medium">Quick actions</h2><nav className="divide-y rounded-md border">{QUICK_ACTIONS.map(action=><Link key={action.href} to={action.href} className="flex h-10 items-center gap-2 px-4 text-sm hover:bg-muted"><action.icon className="size-4 text-muted-foreground"/>{action.label}</Link>)}</nav></section>
 </div>}
 <div className="grid gap-6 xl:grid-cols-2">{blocks.map(block=><section key={block.title} className="flex flex-col gap-3"><div className="flex items-center justify-between"><h2 className="text-sm font-medium">{block.title}</h2><Link to={block.path} className="text-xs text-muted-foreground hover:underline">View all</Link></div><div className="overflow-hidden rounded-md border">{block.result.isLoading?<TableSkeleton columns={block.columns.length} rows={5}/>:block.result.error?<p role="alert" className="p-4 text-sm text-destructive">{block.result.error}</p>:<DataTable rows={block.result.data??[]} columns={block.columns} base={block.path} empty={<EmptyState {...block.empty}/>}/>}</div></section>)}</div>
 </>;
}
