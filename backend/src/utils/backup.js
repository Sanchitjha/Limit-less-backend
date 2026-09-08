import fs from 'node:fs/promises';
import path from 'node:path';
import { User } from '../db/models/User.js';
import { Assessment } from '../db/models/Assessment.js';
import { Plan } from '../db/models/Plan.js';
import { Enquiry } from '../db/models/Enquiry.js';
import { AuditLog } from '../db/models/AuditLog.js';

export async function createDatabaseBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'backups');
  await fs.mkdir(backupDir, { recursive: true });

  const [users, assessments, plans, enquiries, auditLogs] = await Promise.all([
    User.find().lean(),
    Assessment.find().lean(),
    Plan.find().lean(),
    Enquiry.find().lean(),
    AuditLog.find().lean(),
  ]);

  const backupData = {
    timestamp,
    counts: {
      users: users.length,
      assessments: assessments.length,
      plans: plans.length,
      enquiries: enquiries.length,
      auditLogs: auditLogs.length,
    },
    data: { users, assessments, plans, enquiries, auditLogs },
  };

  const backupPath = path.join(backupDir, `backup_${timestamp}.json`);
  await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');

  return {
    success: true,
    backupFile: `backup_${timestamp}.json`,
    backupPath,
    counts: backupData.counts,
  };
}
