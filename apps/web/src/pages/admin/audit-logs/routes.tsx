import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RoleGuard } from '@/components/global/role-guard';
import { RESOURCES } from '@/constants/resources';
import { ADMIN_ONLY } from '@/constants/roles';
const List=lazy(()=>import('@/pages/admin/audit-logs/index'));const Detail=lazy(()=>import('@/pages/admin/audit-logs/detail'));const New=lazy(()=>import('@/pages/admin/audit-logs/new'));const Edit=lazy(()=>import('@/pages/admin/audit-logs/edit'));
const definition=RESOURCES.audit;
export const routes:RouteObject[]=[{element:<RoleGuard roles={ADMIN_ONLY} redirect/>,children:[{path:definition.path,element:<List/>},{path:`${definition.path}/new`,element:<RoleGuard roles={definition.writeRoles}><New/></RoleGuard>},{path:`${definition.path}/:id`,element:<Detail/>},{path:`${definition.path}/:id/edit`,element:<RoleGuard roles={definition.writeRoles}><Edit/></RoleGuard>}]}];
