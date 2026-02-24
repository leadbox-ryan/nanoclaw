/**
 * Firebase/Google Cloud API wrapper for NanoClaw.
 * Provides BigQuery, Firestore, and Cloud Storage access.
 */

import { BigQuery } from '@google-cloud/bigquery';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

export interface BigQueryResult {
  rows: any[];
  schema: Array<{ name: string; type: string }>;
}

export class FirebaseApi {
  private bigquery: BigQuery;
  private firestore: Firestore;
  private storage: Storage;

  constructor(credentialsPath?: string) {
    const options = credentialsPath ? { keyFilename: credentialsPath } : {};

    this.bigquery = new BigQuery(options);
    this.firestore = new Firestore(options);
    this.storage = new Storage(options);
  }

  async testConnection(): Promise<boolean> {
    try {
      // Try to list datasets as a connection test
      await this.bigquery.getDatasets({ maxResults: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async queryBigQuery(query: string): Promise<BigQueryResult> {
    const [job] = await this.bigquery.createQueryJob({ query });
    const [rows] = await job.getQueryResults();

    // Get schema from job metadata
    const [metadata] = await job.getMetadata();
    const schema = metadata.configuration?.query?.destinationTable?.schema?.fields?.map((field: any) => ({
      name: field.name,
      type: field.type,
    })) || [];

    return { rows, schema };
  }

  async getFirestoreDoc(collection: string, docId: string): Promise<any> {
    const docRef = this.firestore.collection(collection).doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error(`Document ${collection}/${docId} not found`);
    }

    return {
      id: doc.id,
      data: doc.data(),
      createTime: doc.createTime?.toDate().toISOString(),
      updateTime: doc.updateTime?.toDate().toISOString(),
    };
  }

  async queryFirestore(
    collection: string,
    field?: string,
    operator?: string,
    value?: any,
    limit: number = 10,
  ): Promise<any[]> {
    let query: any = this.firestore.collection(collection);

    if (field && operator && value !== undefined) {
      query = query.where(field, operator as any, value);
    }

    query = query.limit(limit);

    const snapshot = await query.get();

    return snapshot.docs.map((doc: any) => ({
      id: doc.id,
      data: doc.data(),
    }));
  }

  async getStorageFile(bucket: string, filePath: string): Promise<{ content: Buffer; metadata: any }> {
    const file = this.storage.bucket(bucket).file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`File ${bucket}/${filePath} not found`);
    }

    const [content] = await file.download();
    const [metadata] = await file.getMetadata();

    return { content, metadata };
  }

  async listStorageFiles(bucket: string, prefix?: string, maxResults: number = 100): Promise<any[]> {
    const [files] = await this.storage.bucket(bucket).getFiles({
      prefix,
      maxResults,
    });

    return files.map(file => ({
      name: file.name,
      bucket: file.bucket.name,
      size: file.metadata.size,
      contentType: file.metadata.contentType,
      updated: file.metadata.updated,
    }));
  }
}
