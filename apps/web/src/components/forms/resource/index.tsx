import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ResourceDefinition } from '@/types/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Form,FormField,FormItem,FormLabel,FormControl,FormMessage } from '@/components/ui/form';
import { Alert,AlertDescription } from '@/components/ui/alert';
import { rupeesToPaise,paiseToRupees } from '@/lib/money';
import { read } from '@/lib/display';
import { todayInBusinessTz } from '@/lib/dates';
import { useMutation } from '@/hooks/workspace/use-mutation';
import { MultiEntitySelect } from '@/components/global/multi-entity-select';
import { EntitySelect } from '@/components/global/entity-select';
const lineSchema = z.object({productId:z.coerce.number().int().positive(),variantId:z.coerce.number().optional(),taxId:z.coerce.number().optional(),quantity:z.coerce.number().int().positive()});
interface ResourceFormProps { definition: ResourceDefinition; initial?: unknown; id?: string; contextId?:string; onSuccess: (data: unknown) => void; }
export function ResourceForm({definition,initial,id,contextId,onSuccess}: ResourceFormProps): React.JSX.Element {
 const editing = Boolean(id); const mutation = useMutation(onSuccess);
 const limited = definition.api === '/subscriptions' && !['DRAFT','QUOTATION'].includes(String(read(initial,'status') ?? 'DRAFT'));
 const fields = definition.fields.filter(f => !(editing && (f.type === 'password' || (definition.api === '/staff' && f.key === 'email'))) && (!limited || ['notes','paymentTermId'].includes(f.key)));
 const schema = limited ? z.object({notes:z.string().optional(),paymentTermId:z.number().optional()}) : (editing ? definition.editSchema ?? definition.schema : definition.schema);
 function toBody(values: Record<string,unknown>, lines: z.output<typeof lineSchema>[]): unknown {
  const body: Record<string,unknown> = {};
  for(const f of fields) {
   if(f.type === 'lines') { body.lines = lines.map(l => Object.fromEntries(Object.entries(l).filter(([,v])=>v !== undefined && v !== 0))); continue; }
   const value = values[f.key]; if(value === '' || value === undefined) continue;
   body[f.key] = f.type === 'money' ? rupeesToPaise(String(value)) : f.type === 'number' ? Number(value) : value;
  }
  return body;
 }
 const validation = z.object({ values: z.record(z.string(),z.unknown()), lines: z.array(lineSchema) }).superRefine((value,ctx) => {
  try { const result = schema?.safeParse(toBody(value.values,value.lines)); if(result && !result.success) for(const issue of result.error.issues) ctx.addIssue({code:'custom',message:issue.message,path: issue.path[0] === 'lines' ? issue.path : ['values',...issue.path]}); }
  catch { ctx.addIssue({code:'custom',message:'Enter valid amounts with at most two decimal places',path:['values']}); }
 });
 const defaults: Record<string,unknown> = {};
 for(const field of fields) { const value = read(initial,field.key); defaults[field.key] = value ?? (field.type === 'boolean' ? field.key === 'isActive' : field.type === 'date' && ['startDate','startDate','availableFrom','runDate'].includes(field.key) ? todayInBusinessTz() : field.options?.[0] ?? ''); if(typeof value === 'number' && field.type === 'money') defaults[field.key] = paiseToRupees(value); if(typeof value === 'string' && field.type === 'date') defaults[field.key]=value.slice(0,10); }
 const existingLines = read(initial,'lines');
 const form = useForm({ resolver:zodResolver(validation),defaultValues:{values:defaults,lines:Array.isArray(existingLines) ? existingLines.map(l=>({productId:Number(read(l,'productId')),quantity:Number(read(l,'quantity')),variantId:read(l,'variantId') ? Number(read(l,'variantId')) : undefined,taxId:read(l,'taxId') ? Number(read(l,'taxId')) : undefined})) : []} });
 const array = useFieldArray({control:form.control,name:'lines'});
 const endpoint = editing ? definition.update : definition.create;
 return <Form {...form}><form className="space-y-6" onSubmit={form.handleSubmit(values => { if(endpoint && schema) void mutation.submit(endpoint,schema.parse(toBody(values.values,values.lines)),id??contextId); })}>
  {mutation.error && <Alert variant="destructive"><AlertDescription>{mutation.error}</AlertDescription></Alert>}
  <div className="grid gap-5 sm:grid-cols-2">{fields.filter(f=>f.type !== 'lines').map(f=><FormField key={f.key} control={form.control} name={`values.${f.key}`} render={({field})=><FormItem className={f.type === 'textarea' ? 'sm:col-span-2' : ''}><FormLabel>{f.label}{f.type === 'money' && ['rate','value'].includes(f.key) ? (form.watch('values.type') === 'PERCENTAGE' ? ' (%)' : ' (₹)') : ''}</FormLabel><FormControl>
   {f.type==='multi'?<MultiEntitySelect value={field.value} onChange={field.onChange}/>:f.key.endsWith('Id') && !['taxId'].includes(f.key) ? <EntitySelect value={String(field.value ?? '')} onChange={field.onChange} resource={f.key.replace('Id','')} /> : f.type === 'boolean' ? <input type="checkbox" checked={Boolean(field.value)} onChange={e=>field.onChange(e.target.checked)} className="size-5 accent-primary"/> : f.options ? <NativeSelect value={String(field.value ?? '')} onChange={field.onChange}>{f.options.map(o=><option key={o}>{o}</option>)}</NativeSelect> : f.type === 'textarea' ? <Textarea {...field} value={String(field.value ?? '')}/> : <Input {...field} disabled={(f.key==='billingPeriod' && Number(read(initial,'activeSubscriptionCount'))>0)||(f.key==='scope'&&Number(read(initial,'usedCount'))>0)} value={String(field.value ?? '')} type={['money','percent'].includes(f.type ?? '') ? 'text' : f.type ?? 'text'} inputMode={f.type === 'money' ? 'decimal' : undefined}/>}
  </FormControl><FormMessage/>{mutation.fields[f.key] && <p className="text-sm text-destructive">{mutation.fields[f.key]}</p>}</FormItem>}/> )}</div>
  {fields.some(f=>f.type === 'lines') && <section className="flex flex-col gap-3"><h3 className="text-sm font-medium">Line items</h3><p className="text-sm text-muted-foreground">Prices, taxes, and totals are calculated when saved.</p>{array.fields.map((line,index)=><div key={line.id} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-3"><div><label className="text-xs">Product</label><EntitySelect resource="product" value={String(form.watch(`lines.${index}.productId`) ?? '')} onChange={v=>{form.setValue(`lines.${index}.productId`,Number(v));form.setValue(`lines.${index}.variantId`,undefined);}}/></div><div><label className="text-xs">Variant (optional)</label><EntitySelect resource="variant" parentId={Number(form.watch(`lines.${index}.productId`))} value={String(form.watch(`lines.${index}.variantId`)??'')} onChange={v=>form.setValue(`lines.${index}.variantId`,v?Number(v):undefined)}/></div><div><label className="text-xs">Quantity</label><Input type="number" min={1} {...form.register(`lines.${index}.quantity`,{valueAsNumber:true})}/></div><div><label className="text-xs">Tax (optional)</label><EntitySelect resource="tax" value={String(form.watch(`lines.${index}.taxId`) ?? '')} onChange={v=>form.setValue(`lines.${index}.taxId`,v ? Number(v) : undefined)}/></div><Button type="button" variant="ghost" onClick={()=>array.remove(index)}>Remove</Button></div>)}<p className="text-sm text-destructive">{form.formState.errors.lines?.message}</p><Button type="button" variant="outline" onClick={()=>array.append({productId:0,quantity:1,variantId:undefined,taxId:undefined})}>Add line</Button></section>}
  {definition.api === '/payment-terms' && <p className="text-sm text-muted-foreground">Making this the default clears the previous default.</p>}
  <div className="flex justify-end border-t pt-5"><Button type="submit" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : editing ? 'Save changes' : `Create ${definition.singular.toLowerCase()}`}</Button></div>
 </form></Form>;
}
