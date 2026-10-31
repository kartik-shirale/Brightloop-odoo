import { useCallback,useState } from 'react';
import type { InvoicePreviewDto,GenerateInvoiceRequest } from '@brightloop/shared';
import { useResource } from '@/hooks/common/use-resource';
import { useMutation } from '@/hooks/workspace/use-mutation';
import { todayInBusinessTz } from '@/lib/dates';
export function useInvoiceGeneration(onSuccess:(data:unknown)=>void,subscriptionId?:string): { subscription:string;setSubscription:(value:string)=>void;asOf:string;setAsOf:(value:string)=>void;autoConfirm:boolean;setAutoConfirm:(value:boolean)=>void;preview:ReturnType<typeof useResource<InvoicePreviewDto>>;mutation:ReturnType<typeof useMutation>;generate:()=>void } {
 const [subscription,setSubscription]=useState(subscriptionId??'');const [asOf,setAsOf]=useState(todayInBusinessTz());const [autoConfirm,setAutoConfirm]=useState(false);
 const preview=useResource<InvoicePreviewDto>('/invoices/preview',new URLSearchParams({subscriptionId:subscription}).toString(),Boolean(subscription));
 const mutation=useMutation(onSuccess);
 const generate=useCallback(()=>{const request:GenerateInvoiceRequest={subscriptionId:Number(subscription),asOf,autoConfirm};void mutation.submit('POST /api/v1/invoices/generate',request);},[subscription,asOf,autoConfirm,mutation.submit]);
 return {subscription,setSubscription,asOf,setAsOf,autoConfirm,setAutoConfirm,preview,mutation,generate};
}
