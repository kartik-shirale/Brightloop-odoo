import type { ApiEndpoint, ApiSuccess } from '@brightloop/shared';
import { client } from '@/api/client';
export async function mutateResource(endpoint: ApiEndpoint, body: unknown, id?: string): Promise<unknown> {
 const [method = 'POST', template = ''] = endpoint.split(' ');
 const [recordId = '', childId = ''] = (id ?? '').split('/');
 const payloadId = typeof body === 'object' && body !== null && 'discountId' in body ? String(body.discountId) : recordId;
 const path = template.replace(':id', payloadId).replace(':productId', recordId).replace(':variantId', childId).replace(':subscriptionId', childId);
 if(typeof body === 'object' && body !== null && 'discountId' in body) { const {discountId: _discountId, ...payload} = body; body = payload; }
 const response = await client.request<ApiSuccess<unknown>>({ method, url: path, data: body });
 return response.data.data;
}
