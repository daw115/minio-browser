const express = require('express');
const { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

function getClient(endpoint, accessKey, secretKey) {
  return new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
}

// List buckets
app.post('/api/buckets', async (req, res) => {
  try {
    const { endpoint, accessKey, secretKey } = req.body;
    const client = getClient(endpoint, accessKey, secretKey);
    const data = await client.send(new ListBucketsCommand({}));
    res.json({ buckets: (data.Buckets || []).map(b => b.Name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List objects
app.post('/api/objects', async (req, res) => {
  try {
    const { endpoint, accessKey, secretKey, bucket, prefix = '', recursive = false, search = '' } = req.body;
    const client = getClient(endpoint, accessKey, secretKey);

    let allObjects = [];
    let allPrefixes = [];
    let token = undefined;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: recursive ? undefined : '/',
        MaxKeys: 1000,
        ContinuationToken: token,
      });
      const data = await client.send(cmd);
      allObjects = allObjects.concat(data.Contents || []);
      allPrefixes = allPrefixes.concat(data.CommonPrefixes || []);
      token = data.IsTruncated ? data.NextContinuationToken : undefined;
    } while (token);

    let files = allObjects
      .filter(o => o.Key !== prefix)
      .map(o => ({
        type: 'file',
        key: o.Key,
        name: o.Key.split('/').filter(Boolean).pop(),
        size: o.Size,
        date: o.LastModified,
      }));

    const folders = allPrefixes.map(p => ({
      type: 'folder',
      key: p.Prefix,
      name: p.Prefix.replace(prefix, '').replace(/\/$/, ''),
      size: null,
      date: null,
    }));

    if (search) {
      const q = search.toLowerCase();
      files = files.filter(f => f.name.toLowerCase().includes(q));
    }

    res.json({ files: [...folders, ...files] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Presigned download URL
app.post('/api/download-url', async (req, res) => {
  try {
    const { endpoint, accessKey, secretKey, bucket, key } = req.body;
    const client = getClient(endpoint, accessKey, secretKey);
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
