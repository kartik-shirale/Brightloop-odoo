import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RoleGuard } from '@/components/global/role-guard';
import { RESOURCES } from '@/constants/resources';
import { STAFF_ROLES } from '@/constants/roles';
const List=lazy(()=>import('@/pages/billing-runs/index'));const Detail=lazy(()=>import('@/pages/billing-runs/detail'));const New=lazy(()=>import('@/pages/billing-runs/new'));const Edit=lazy(()=>import('@/pages/billing-runs/edit'));
const definition=RESOURCES.runs;
export const routes:RouteObject[]=[{element:<RoleGuard roles={STAFF_ROLES} redirect/>,children:[{path:definition.path,element:<List/>},{path:`${definition.path}/new`,element:<RoleGuard roles={definition.writeRoles}><New/></RoleGuard>},{path:`${definition.path}/:id`,element:<Detail/>},{path:`${definition.path}/:id/edit`,element:<RoleGuard roles={definition.writeRoles}><Edit/></RoleGuard>}]}];
