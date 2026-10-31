// Explicit fixture identities for the original conformance/runtime assertions.
// Production code never fabricates a default team or member.
export async function seedLayout(db) {
  await db.query(`INSERT INTO project_identity (singleton,project_id,minimum_writer_protocol)
    VALUES (1,'00000000-0000-4000-8000-000000000001',1) ON CONFLICT (singleton) DO NOTHING`);
  await db.query(`INSERT INTO teams (team_id,name,function_text,config_version,written_by_client,written_by_version)
    VALUES ('fixture-team','Fixture team','Fixture',1,'team-orchestrator','0.0.0') ON CONFLICT (team_id) DO NOTHING`);
  await db.query(`INSERT INTO team_settings (team_id,auto_close,idle_minutes,reopen,max_open,launch,batch_size,auto_scratch,assumptions,scratch_dir,pickup_window_minutes,answer_window_minutes,task_window_minutes,replay_interval_ms)
    VALUES ('fixture-team',0,10,'resume',8,'demand',3,0,0,'.scratch',1,2,NULL,1000) ON CONFLICT (team_id) DO NOTHING`);
  for (const id of ['head', 'worker', 'worker-A', 'worker-B', 'worker-0', 'worker-1']) {
    await db.query(`INSERT INTO members (member_id,team_id,name,boss_member_id,role,level,model,effort,membership_state,allow_agent,allow_write,generation)
      VALUES (:id,'fixture-team',:id,:boss,'Fixture',1,'default','default','active',0,0,1) ON CONFLICT (member_id) DO NOTHING`, { id, boss: id === 'head' ? null : 'head' });
  }
}

// Pair fixture rows in a caller-owned transaction; never a production default.
export async function seedDelivery(db, { id = 'delivery', run = 'run', team = 'fixture-team', thread = 'thread', status = 'outstanding', generation = 1, consumerGeneration = 1 } = {}) {
  await db.query(`INSERT INTO deliveries (delivery_id,run_id,consumer_generation,status,generation,team_id,message_id)
    VALUES (:id,:run,:consumer,:status,:generation,:team,:message)`, { id, run, consumer: consumerGeneration, status, generation, team, message: `message-${id}` });
  await db.query(`INSERT INTO messages (message_id,delivery_id,team_id,thread_id,sender_member_id,recipient_member_id,body,kind,created_at_ms)
    VALUES (:message,:id,:team,:thread,'head','worker','Fixture content','status',1000)`, { message: `message-${id}`, id, team, thread });
}
