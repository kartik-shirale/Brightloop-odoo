import { Link } from 'react-router-dom';
import { Table,TableHeader,TableRow,TableHead,TableBody,TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatBps,formatPaise } from '@/lib/format';
import { display,read,titleCase } from '@/lib/display';
interface DataTableProps { rows: unknown[]; columns: string[]; base?: string; onSelect?:(row:unknown)=>void; }
export function DataTable({rows,columns,base,onSelect}:DataTableProps):React.JSX.Element {
 return <Table><TableHeader><TableRow>{columns.map(key=><TableHead key={key} className="whitespace-nowrap">{titleCase(key)}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length ? rows.map((row,index)=><TableRow key={String(read(row,'id') ?? read(row,'number') ?? index)}>{columns.map((key,i)=><TableCell key={key} className="max-w-xs py-4">{onSelect&&i===0?<button className="font-medium text-primary hover:underline" onClick={()=>onSelect(row)}>{display(read(row,key),key)}</button>:base && i===0 ? <Link className="font-medium text-primary hover:underline" to={`${base}/${String(read(row,'id'))}`}>{display(read(row,key),key)}</Link> : ['status','state'].includes(key) ? <Badge variant="outline">{display(read(row,key),key)}</Badge> : (['rate','value'].includes(key)&&typeof read(row,key)==='number'?(read(row,'type')==='PERCENTAGE'?formatBps(Number(read(row,key))):formatPaise(Number(read(row,key)))):display(read(row,key),key))}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length} className="h-40 text-center text-muted-foreground">No records found. Try adjusting your filters.</TableCell></TableRow>}</TableBody></Table>;
}
