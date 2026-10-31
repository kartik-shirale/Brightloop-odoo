import { useNavigate,useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import type { CreateSubscriptionFromTemplateRequest } from '@brightloop/shared';
import { ResourceForm } from '@/components/forms/resource';
import { Card,CardContent } from '@/components/ui/card';
import { STAFF_ROLES } from '@/constants/roles';
import type { ResourceDefinition } from '@/types/workspace';
const schema=z.object({templateId:z.number().int().positive(),customerId:z.number().int().positive(),startDate:z.string().min(1),expiryDate:z.string().optional(),paymentTermId:z.number().int().positive().optional(),notes:z.string().optional()}) satisfies z.ZodType<CreateSubscriptionFromTemplateRequest>;
const definition:ResourceDefinition={title:'From template',singular:'Subscription',path:'/subscriptions',api:'/subscriptions/from-template',columns:[],fields:[{key:'templateId',label:'Quotation template',type:'number'},{key:'customerId',label:'Customer',type:'number'},{key:'startDate',label:'Start date',type:'date'},{key:'expiryDate',label:'Expiry date',type:'date'},{key:'paymentTermId',label:'Payment term',type:'number'},{key:'notes',label:'Notes',type:'textarea'}],schema,create:'POST /api/v1/subscriptions/from-template',writeRoles:STAFF_ROLES};
export default function FromTemplatePage():React.JSX.Element{const navigate=useNavigate();const [params]=useSearchParams();return <div className="mx-auto max-w-3xl space-y-6"><h1 className="text-3xl font-semibold">Create from a template</h1><p className="text-muted-foreground">Start a new subscription with a reusable quotation template.</p><Card><CardContent className="p-6"><ResourceForm definition={definition} initial={{templateId:params.get('templateId')??''}} onSuccess={()=>navigate('/subscriptions')}/></CardContent></Card></div>;}
