import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { Table,TableHeader,TableRow,TableHead,TableBody,TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/global/empty-state';
import { cn } from '@/lib/utils';
import { formatBps,formatPaise } from '@/lib/format';
import { display,pendingBillingNote,read,titleCase } from '@/lib/display';
interface DataTableProps { rows: unknown[]; columns: string[]; base?: string; onSelect?:(row:unknown)=>void; empty?: ReactNode; }
/** A column is numeric when its first non-empty value is a number; numeric columns align right. */
function numericColumns(rows:unknown[],columns:string[]):Set<string>{return new Set(columns.filter(key=>{const sample=rows.map(row=>read(row,key)).find(value=>value!==null&&value!==undefined);return typeof sample==='number';}));}
function cellValue(row:unknown,key:string):string{const value=read(row,key);if(['rate','value'].includes(key)&&typeof value==='number')return read(row,'type')==='PERCENTAGE'?formatBps(value):formatPaise(value);return display(value,key);}
export function DataTable({rows,columns,base,onSelect,empty}:DataTableProps):React.JSX.Element {
 if(!rows.length)return <>{empty??<EmptyState icon={Inbox} title="Nothing here yet" description="Records will appear here once they are created."/>}</>;
 const numeric=numericColumns(rows,columns);
 return <Table><TableHeader><TableRow className="hover:bg-transparent">{columns.map(key=><TableHead key={key} className={cn('h-10 whitespace-nowrap text-xs font-normal text-muted-foreground',numeric.has(key)&&'text-right')}>{titleCase(key)}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row,index)=><TableRow key={String(read(row,'id') ?? read(row,'number') ?? index)} className="h-10">{columns.map((key,i)=><TableCell key={key} className={cn('max-w-xs truncate py-0',numeric.has(key)&&'text-right tabular-nums')}>{onSelect&&i===0?<button type="button" className="font-medium hover:underline" onClick={()=>onSelect(row)}>{cellValue(row,key)}</button>:base && i===0 ? <Link className="font-medium hover:underline" to={`${base}/${String(read(row,'id'))}`}>{cellValue(row,key)}</Link> : ['status','state'].includes(key) ? <Badge variant="outline" className="font-normal">{cellValue(row,key)}</Badge> : key==='nextBillingDate'&&pendingBillingNote(row) ? <span className="text-muted-foreground">{pendingBillingNote(row)}</span> : cellValue(row,key)}</TableCell>)}</TableRow>)}</TableBody></Table>;
}
