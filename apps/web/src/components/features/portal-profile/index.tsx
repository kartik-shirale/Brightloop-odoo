import { z } from 'zod';
import { ResourceForm } from '@/components/forms/resource';
import { useResource } from '@/hooks/common/use-resource';
import { Card,CardContent } from '@/components/ui/card';
import { CUSTOMER_ONLY } from '@/constants/roles';
import type { PortalProfileDto,UpdatePortalProfileRequest } from '@brightloop/shared';
const schema=z.object({name:z.string().min(1),companyName:z.string().optional(),phone:z.string().optional(),taxId:z.string().optional(),addressLine1:z.string().optional(),addressLine2:z.string().optional(),city:z.string().optional(),state:z.string().optional(),postalCode:z.string().optional(),country:z.string().optional()}) satisfies z.ZodType<UpdatePortalProfileRequest>;
const definition={title:'Profile',singular:'Profile',api:'/me',path:'/portal/profile',columns:[],fields:['name','companyName','phone','taxId','addressLine1','addressLine2','city','state','postalCode','country'].map(key=>({key,label:key.replace(/([A-Z])/g,' $1')})),editSchema:schema,update:'PATCH /api/v1/me' as const,writeRoles:CUSTOMER_ONLY};
export function Profile():React.JSX.Element {const result=useResource<PortalProfileDto>('/me');return <div className="mx-auto max-w-3xl space-y-6"><h1 className="text-3xl font-semibold">Your profile</h1><p className="text-muted-foreground">Keep your billing and contact information up to date.</p>{result.error?<p role="alert">{result.error}</p>:result.data&&<Card><CardContent className="p-6"><p className="mb-6 text-sm text-muted-foreground">Email: {result.data.email} (read-only)</p><ResourceForm definition={definition} id="me" initial={result.data} onSuccess={result.refetch}/></CardContent></Card>}</div>;}
