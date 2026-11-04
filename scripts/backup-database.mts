import { backupDatabase,restoreLocalBackup } from '../db/tools/backup.ts';
try{
  const [command,path,confirmation,...extra]=process.argv.slice(2),bin=process.env.PG_BIN??'',key=process.env.BACKUP_ENCRYPTION_KEY??'';
  if(extra.length||!path)throw new Error();
  if(command==='backup'&&!confirmation){const result=await backupDatabase(process.env.BACKUP_DATABASE_URL??'',path,key,bin);console.log(JSON.stringify({encryptedBackup:true,bytes:result.bytes}));}
  else if(command==='restore-local'&&confirmation==='--confirm-new-local-restore'){await restoreLocalBackup(process.env.RESTORE_DATABASE_URL??'',path,key,bin);console.log('Isolated restore completed. Verify the migration ledger, data and grants before relying on this backup.');}
  else throw new Error();
}catch{console.error('Backup or isolated restore failed. Review the protected paths, key, PostgreSQL tools and operator procedure. No hosted restore is supported.');process.exitCode=1;}
