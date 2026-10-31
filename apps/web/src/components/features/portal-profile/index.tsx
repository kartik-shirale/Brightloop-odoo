import { z } from 'zod';
import { ResourceForm } from '@/components/forms/resource';
import { ListSkeleton } from '@/components/global/list-skeleton';
import { PageHeader } from '@/components/global/page-header';
import { Alert,AlertDescription } from '@/components/ui/alert';
import { useResource } from '@/hooks/common/use-resource';
import { CUSTOMER_ONLY } from '@/constants/roles';
import type { PortalProfileDto,UpdatePortalProfileRequest } from '@brightloop/shared';
const schema=z.object({name:z.string().min(1),companyName:z.string().optional(),phone:z.string().optional(),taxId:z.string().optional(),addressLine1:z.string().optional(),addressLine2:z.string().optional(),city:z.string().optional(),state:z.string().optional(),postalCode:z.string().optional(),country:z.string().optional()}) satisfies z.ZodType<UpdatePortalProfileRequest>;
const definition={title:'Profile',singular:'Profile',api:'/me',path:'/portal/profile',columns:[],fields:['name','companyName','phone','taxId','addressLine1','addressLine2','city','state','postalCode','country'].map(key=>({key,label:key.replace(/([A-Z])/g,' $1')})),editSchema:schema,update:'PATCH /api/v1/me' as const,writeRoles:CUSTOMER_ONLY};
export function Profile():React.JSX.Element {const result=useResource<PortalProfileDto>('/me');return <div className="flex max-w-3xl flex-col gap-6"><PageHeader title="Profile" description={result.data?`Signed in as ${result.data.email}. Email cannot be changed here.`:undefined}/>{result.error?<Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>:<section className="rounded-md border p-4">{result.isLoading?<ListSkeleton variant="grid" rows={10}/>:result.data&&<ResourceForm definition={definition} id="me" initial={result.data} onSuccess={result.refetch}/>}</section>}</div>;}
