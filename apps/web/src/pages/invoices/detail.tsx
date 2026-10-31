import { useParams } from 'react-router-dom';
import { Workspace } from '@/components/features/workspace';
import { RESOURCES } from '@/constants/resources';
export default function FeaturePage():React.JSX.Element { const {id}=useParams(); return <Workspace definition={RESOURCES.invoices} id={id}/>; }
