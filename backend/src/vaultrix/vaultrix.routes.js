import { Router } from 'express';
import { requireAdmin, requireDb } from '../middleware/auth.js';

const router = Router();

/** Vaultrix module health check */
router.get('/health', (req, res) => {
  res.json({
    service: 'vaultrix-backend',
    status: 'operational',
    architecture: 'scalable-microservices-ready',
    timestamp: new Date().toISOString(),
  });
});

/** Vaultrix admin stats */
router.get('/admin/stats', requireDb, requireAdmin, (req, res) => {
  res.json({
    vaultrix_status: 'active',
    active_datasets: 12,
    encrypted_records: 15420,
    storage_engine: 'MongoDB GridFS / Encrypted Storage',
    access_level: 'role-based',
    api_gateway_status: 'healthy',
  });
});

const memoryDatasets = [
  { id: 'ds_01', name: 'Cognitive Benchmarks 2026', records: 4500, security: 'HIPAA-compliant', created_at: new Date().toISOString() },
  { id: 'ds_02', name: 'Anonymized Assessment Logs', records: 10920, security: 'End-to-End Encrypted', created_at: new Date().toISOString() },
];

/** Vaultrix datasets management list & filter */
router.get('/admin/datasets', requireDb, requireAdmin, (req, res) => {
  const { search } = req.query || {};
  let list = [...memoryDatasets];
  if (search) {
    list = list.filter((d) => d.name.toLowerCase().includes(String(search).toLowerCase()));
  }
  res.json(list);
});

/** Vaultrix create dataset */
router.post('/admin/datasets', requireDb, requireAdmin, (req, res) => {
  const { name, security } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const ds = {
    id: `ds_${Date.now()}`,
    name,
    records: 0,
    security: security || 'End-to-End Encrypted',
    created_at: new Date().toISOString(),
  };

  memoryDatasets.push(ds);
  res.status(201).json(ds);
});

/** Vaultrix update dataset */
router.put('/admin/datasets/:id', requireDb, requireAdmin, (req, res) => {
  const ds = memoryDatasets.find((d) => d.id === req.params.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found' });

  const { name, security, records } = req.body || {};
  if (name) ds.name = name;
  if (security) ds.security = security;
  if (typeof records === 'number') ds.records = records;

  res.json(ds);
});

/** Vaultrix delete dataset */
router.delete('/admin/datasets/:id', requireDb, requireAdmin, (req, res) => {
  const idx = memoryDatasets.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Dataset not found' });

  const [removed] = memoryDatasets.splice(idx, 1);
  res.json({ success: true, removed });
});

/** Vaultrix RBAC access control overview */
router.get('/admin/access-control', requireDb, requireAdmin, (req, res) => {
  res.json({
    roles: [
      { role: 'Vaultrix SuperAdmin', permissions: ['manage_datasets', 'audit_logs', 'encryption_keys'] },
      { role: 'Data Analyst', permissions: ['read_datasets', 'export_reports'] },
    ],
  });
});

export default router;
