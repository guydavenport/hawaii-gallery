import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';

export interface AccessRequest {
  email: string;
  name: string;
  provider: string;
  providerId: string;
  status: AccessRequestStatus;
  role: 'admin' | 'guest';
  requestedAt: string;
  decidedAt?: string;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getTableName() {
  return requireEnv('ACCESS_REQUESTS_TABLE');
}

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export async function getAccessRequest(email: string): Promise<AccessRequest | null> {
  const response = await docClient.send(new GetCommand({ TableName: getTableName(), Key: { email } }));
  return (response.Item as AccessRequest) || null;
}

export async function createPendingAccessRequest(input: {
  email: string;
  name: string;
  provider: string;
  providerId: string;
}): Promise<AccessRequest> {
  const item: AccessRequest = {
    ...input,
    status: 'pending',
    role: 'guest',
    requestedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: getTableName(), Item: item }));
  return item;
}

export async function listAccessRequests(): Promise<AccessRequest[]> {
  const items: AccessRequest[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(
      new ScanCommand({ TableName: getTableName(), ExclusiveStartKey: lastEvaluatedKey })
    );
    items.push(...((response.Items || []) as AccessRequest[]));
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function decideAccessRequest(
  email: string,
  status: 'approved' | 'denied',
  role: 'admin' | 'guest'
): Promise<AccessRequest | null> {
  try {
    const response = await docClient.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { email },
        UpdateExpression: 'SET #status = :status, #role = :role, decidedAt = :decidedAt',
        ExpressionAttributeNames: { '#status': 'status', '#role': 'role' },
        ExpressionAttributeValues: {
          ':status': status,
          ':role': role,
          ':decidedAt': new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(email)',
        ReturnValues: 'ALL_NEW',
      })
    );
    return (response.Attributes as AccessRequest) || null;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return null;
    }
    throw error;
  }
}
