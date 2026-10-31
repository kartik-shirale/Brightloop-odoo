import { z } from 'zod';
import { ResourceForm } from '@/components/forms/resource';
import { PageHeader } from '@/components/global/page-header';
import { passwordSchema } from '@/lib/auth-validation';
import { Role } from '@/constants/roles';
import type { ChangePasswordRequest } from '@brightloop/shared';
import type { ResourceDefinition } from '@/types/workspace';
const schema=z.object({currentPassword:z.string().min(1),password:passwordSchema,confirmPassword:z.string().min(1)}).refine(v=>v.password===v.confirmPassword,{path:['confirmPassword'],message:'Passwords do not match'}) satisfies z.ZodType<ChangePasswordRequest>;
const definition:ResourceDefinition={title:'Account security',singular:'Password',api:'/users/me/password',path:'/account',columns:[],fields:[{key:'currentPassword',label:'Current password',type:'password'},{key:'password',label:'New password',type:'password'},{key:'confirmPassword',label:'Confirm new password',type:'password'}],schema,create:'POST /api/v1/users/me/password',writeRoles:[Role.ADMIN,Role.STAFF,Role.CUSTOMER]};
export function Account():React.JSX.Element{return <div className="flex max-w-xl flex-col gap-6"><PageHeader title="Account security" description="Changing your password signs you out of other devices."/><section className="rounded-md border p-4"><ResourceForm definition={definition} onSuccess={()=>window.location.assign('/login')}/></section></div>;}
