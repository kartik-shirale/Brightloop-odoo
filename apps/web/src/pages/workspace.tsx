import { useParams } from 'react-router-dom';
import { Workspace } from '@/components/features/workspace';
import type { ResourceDefinition } from '@/types/workspace';
interface WorkspacePageProps { definition:ResourceDefinition; mode?:'new'|'edit'; }
export default function WorkspacePage({definition,mode}:WorkspacePageProps):React.JSX.Element { const {id}=useParams();return <Workspace key={`${definition.api}:${id??'list'}:${mode??''}`} definition={definition} id={id} mode={mode}/>; }
