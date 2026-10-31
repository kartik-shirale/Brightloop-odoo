import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RoleGuard } from '@/components/global/role-guard';
import { RESOURCES } from '@/constants/resources';
import { STAFF_ROLES } from '@/constants/roles';
const List=lazy(()=>import('@/pages/catalog/products/index'));const Detail=lazy(()=>import('@/pages/catalog/products/detail'));const New=lazy(()=>import('@/pages/catalog/products/new'));const Edit=lazy(()=>import('@/pages/catalog/products/edit'));
const definition=RESOURCES.products;
export const routes:RouteObject[]=[{element:<RoleGuard roles={STAFF_ROLES} redirect/>,children:[{path:definition.path,element:<List/>},{path:`${definition.path}/new`,element:<RoleGuard roles={definition.writeRoles}><New/></RoleGuard>},{path:`${definition.path}/:id`,element:<Detail/>},{path:`${definition.path}/:id/edit`,element:<RoleGuard roles={definition.writeRoles}><Edit/></RoleGuard>}]}];
