import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
interface TextFormFieldProps<T extends FieldValues> {
  control: Control<T>; name: FieldPath<T>; label: string; type?: 'text' | 'email' | 'password';
  placeholder?: string; autoComplete?: string; disabled?: boolean;
}
export function TextFormField<T extends FieldValues>({ control, name, label, type = 'text', placeholder, autoComplete, disabled }: TextFormFieldProps<T>): React.JSX.Element {
  return <FormField control={control} name={name} render={({ field }) => <FormItem>
    <FormLabel>{label}</FormLabel><FormControl><Input {...field} value={typeof field.value === 'string' ? field.value : ''}
      type={type} placeholder={placeholder} autoComplete={autoComplete} disabled={disabled} className="h-11 bg-background" /></FormControl><FormMessage />
  </FormItem>} />;
}
