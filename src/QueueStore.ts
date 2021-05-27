import * as SQLite from "expo-sqlite"
import type { RawJob } from "./types"

const mapColumnsToJob = (row: Record<string, any>): RawJob => {
  return {
    id: row.id,
    attempts: row.attempts,
    created: row.created,
    scheduled_for: row.scheduled_for,
    failed: row.failed,
    active: row.active,
    metaData: row.meta_data,
    payload: row.payload,
    priority: row.priority,
    timeout: row.timeout,
    workerName: row.worker_name,
  }
}

export class QueueStore {
  private static _instance: QueueStore
  private _db: SQLite.WebSQLDatabase

  constructor() {
    this._db = SQLite.openDatabase("queue.db")
    this._db.transaction((tx) => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS Job(
        id CHAR(36) PRIMARY KEY NOT NULL,
        worker_name CHAR(255) NOT NULL,
        active INTEGER NOT NULL,
        payload CHAR(1024),
        meta_data CHAR(1024),
        attempts INTEGER NOT NULL,
        created CHAR(255),
        scheduled_for CHAR(255) NOT NULL DEFAULT "now",
        failed CHAR(255),
        timeout INTEGER NOT NULL,
        priority Integer NOT NULL
        );`,
      )
    })
  }

  static get instance() {
    if (this._instance) {
      return this._instance
    } else {
      this._instance = new QueueStore()
      return this._instance
    }
  }

  private query<T = any>(query: string, args: any[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
      this._db.transaction((tx) => {
        tx.executeSql(
          query,
          args,
          // @ts-ignore
          (_, { rows: { _array } }) =>
            resolve((_array ?? []).map((row: any) => (row?.id ? mapColumnsToJob(row) : row))),
          (_, error) => {
            reject(error)
            return true
          },
        )
      })
    })
  }

  private getJobsByQuery(query: string, args: any[] = []): Promise<RawJob[]> {
    return this.query<RawJob[]>(query, args)
  }

  async getJobs(): Promise<RawJob[]> {
    return this.getJobsByQuery(
      `SELECT * FROM job WHERE datetime("now") >= datetime(scheduled_for) ORDER BY priority DESC,datetime(created);`,
    )
  }

  async getActiveMarkedJobs(): Promise<RawJob[]> {
    return this.getJobsByQuery(`SELECT * FROM job WHERE active == 1;`)
  }

  async getNextJob(): Promise<RawJob | {}> {
    const [job] = await this.getJobsByQuery(
      `SELECT * FROM job WHERE active == 0 AND failed == '' AND datetime("now") >= datetime(scheduled_for) ORDER BY priority DESC,datetime(created) LIMIT 1;`,
    )
    return job ?? {}
  }

  async getJobsForWorker(worker: string, count: number): Promise<RawJob[]> {
    return this.getJobsByQuery(
      `SELECT * FROM job WHERE active == 0 AND failed == '' AND worker_name == ? AND datetime("now") >= datetime(scheduled_for) ORDER BY priority DESC,datetime(created) LIMIT ?;`,
      [worker, count],
    )
  }

  async hasFutureJobs(): Promise<number> {
    const [row] = await this.query<{ seconds: number }[]>(
      `SELECT abs((julianday("now") - julianday(scheduled_for)) * 86400.0) as seconds FROM job WHERE datetime(scheduled_for) >= datetime("now") AND failed == ''`,
    )
    return row?.seconds ?? -1
  }

  async removeJob(job: RawJob) {
    await this.query("DELETE FROM job WHERE id = ?;", [job.id])
  }

  async removeJobsByWorkerName(name: string) {
    await this.query("DELETE FROM job WHERE worker_name = ?;", [name])
  }

  async updateJob(job: RawJob) {
    await this.query(
      "UPDATE job SET active = ?, failed = ?, meta_data = ?, attempts = ?, scheduled_for = ? WHERE id = ?;",
      [job.active, job.failed, job.metaData, job.attempts, job.scheduled_for, job.id],
    )
  }

  async addJob(job: RawJob) {
    await this.query(
      "INSERT INTO job (id, worker_name, active, payload, meta_data, attempts, created, failed, timeout, priority, scheduled_for) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      [
        job.id,
        job.workerName,
        job.active,
        job.payload,
        job.metaData,
        job.attempts,
        job.created,
        job.failed,
        job.timeout,
        job.priority,
        job.scheduled_for,
      ],
    )
  }
}

export default QueueStore.instance
