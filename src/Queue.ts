import store, { QueueStore } from "./QueueStore"
import { FALSE, Job, RawJob } from "./types"
import { noop, Uuid } from "./utils"
import { CANCEL, Worker, WorkerOptions } from "./Worker"
import add from "date-fns/add"

/**
 * Options to configure the queue
 */
export interface QueueOptions {
  /**
   * A callback function which is called after the queue has been stopped
   * @parameter executedJobs
   */
  onQueueFinish?: (executedJobs: Array<Job<any>>) => void
  /**
   * Interval in which the queue checks for new jobs to execute
   */
  updateInterval?: number
  /**
   * Interval in which the queue checks for schedueld jobs in the future (-1 to disable)
   */
  futureInterval?: number
  /**
   * How many jobs should a worker be able to run at the same time (-1 for unlimited)
   */
  concurrency?: number
}
/**
 * ## Usage
 *
 * ```typescript
 * import queue from 'react-native-job-queue'
 *
 * queue.configure({onQueueFinish:(executedJobs:Job[])=>{
 *      console.log("Queue stopped and executed",executedJobs)
 * }});
 * queue.addWorker("testWorker",async(payload)=>{
 *      return new Promise((resolve) => {
 *      setTimeout(() => {
 *          console.log(payload.text);
 *          resolve();
 *      }, payload.delay);});
 * })
 * queue.addJob("testWorker",{text:"Job example palyoad content text",delay:5000})
 * ```
 */
export class Queue {
  static get instance() {
    if (this.queueInstance) {
      return this.queueInstance
    } else {
      this.queueInstance = new Queue()
      return this.queueInstance
    }
  }

  /**
   * @returns true if the Queue is running and false otherwise
   */
  get isRunning() {
    return this.isActive
  }

  /**
   * @returns the workers map (readonly)
   */
  get registeredWorkers() {
    return this.workers
  }

  private static queueInstance: Queue | null

  private jobStore: QueueStore
  private workers: { [key: string]: Worker<any> }
  private isActive: boolean

  private timeoutId?: ReturnType<typeof setTimeout>
  private futureTimeoutId?: ReturnType<typeof setTimeout>
  private executedJobs: Array<Job<any>>
  private activeJobCount: number

  private concurrency: number
  private updateInterval: number
  private maxFutureInterval: number
  private onQueueFinish: (executedJobs: Array<Job<any>>) => void

  private queuedJobExecuter: any[] = []
  private runningJobPromises: { [key: string]: any }

  private constructor() {
    this.jobStore = store
    this.workers = {}
    this.runningJobPromises = {}
    this.isActive = false

    this.timeoutId = undefined
    this.futureTimeoutId = undefined
    this.executedJobs = []
    this.activeJobCount = 0

    this.updateInterval = 10
    this.maxFutureInterval = 60 * 1000 // 60 seconds
    this.onQueueFinish = noop
    this.concurrency = -1
  }

  /**
   * @returns a promise that resolves all jobs of jobStore
   */
  async getJobs() {
    return await this.jobStore.getJobs()
  }

  /**
   * @param job the job to be deleted
   */
  async removeJob(job: RawJob) {
    return await this.jobStore.removeJob(job)
  }

  /**
   * @param job the job which should be requeued
   */
  async requeueJob(job: RawJob) {
    return await this.jobStore.updateJob({ ...job, failed: "" })
  }

  configure(options: QueueOptions) {
    const {
      onQueueFinish = noop,
      updateInterval = 10,
      concurrency = -1,
      futureInterval = 60 * 1000, // 60 seconds
    } = options
    this.onQueueFinish = onQueueFinish
    this.updateInterval = updateInterval
    this.maxFutureInterval = futureInterval
    this.concurrency = concurrency
  }

  /**
   * adds a [[Worker]] to the queue which can execute Jobs
   * @typeparam P specifies the type of the job-payload.
   * @param name of worker
   * @param executer function to run jobs
   * @param options to configure worker
   */
  addWorker<P extends Record<string, any>>(
    name: string,
    executer: (payload: P) => Promise<any>,
    options: WorkerOptions<P> = {},
  ) {
    if (this.workers[name]) {
      console.warn(`Worker "${name}" already exists.`)
      return
    }
    this.workers[name] = new Worker<P>(name, executer, options)
  }

  /**
   * removes worker from queue
   *
   * @param name
   * @param [deleteRelatedJobs=false] removes all queued jobs releated to the worker if set to true
   */
  removeWorker(name: string, deleteRelatedJobs = false) {
    delete this.workers[name]
    if (deleteRelatedJobs) {
      this.jobStore.removeJobsByWorkerName(name)
    }
  }

  /**
   * adds a job to the queue
   * @param workerName name of the worker which should be used to excute the job
   * @param [payload={}] payload which is passed as parameter to the executer
   * @param [options={ attempts: 0, timeout: 0, priority: 0 }] options to set max attempts, a timeout and a priority
   * @param [startQueue=true] if set to false the queue won't start automaticly when adding a job
   * @returns job id
   */
  addJob<P extends Record<string, unknown>>(
    workerName: string,
    payload: P,
    options: {
      attempts?: number
      timeout?: number
      priority?: number
      runIn?: Duration
      retryIn?: Duration
    } = {},
    startQueue = true,
  ) {
    const { attempts = 0, timeout = 0, priority = 0, runIn, retryIn } = options
    const id: string = Uuid.v4()
    const job: RawJob = {
      id,
      payload: JSON.stringify(payload || {}),
      metaData: JSON.stringify({ failedAttempts: 0, errors: [], retryIn: retryIn }),
      active: FALSE,
      created: new Date().toISOString(),
      scheduled_for: runIn ? add(new Date(), runIn).toISOString() : "now",
      failed: "",
      workerName,
      attempts,
      timeout,
      priority,
    }
    if (!this.workers[job.workerName]) {
      throw new Error(`Missing worker with name ${job.workerName}`)
    }

    this.jobStore.addJob(job)
    if (startQueue && !this.isActive) {
      this.start()
    }

    return id
  }

  /**
   * starts the queue to execute queued jobs
   */
  async start() {
    if (!this.isActive) {
      this.isActive = true
      this.executedJobs = []
      await this.resetActiveJobs()
      this.scheduleQueue()
    }
  }

  /**
   * stop the queue from executing queued jobs
   */
  stop() {
    this.isActive = false
  }

  /**
   * cancel running job
   */
  cancelJob(jobId: string, exception?: Error) {
    const promise = this.runningJobPromises[jobId]
    if (promise && typeof promise[CANCEL] === "function") {
      promise[CANCEL](exception || new Error(`canceled`))
    } else if (!promise[CANCEL]) {
      console.warn("Worker does not have a cancel method implemented")
    } else {
      throw new Error(`Job with id ${jobId} not currently running`)
    }
  }

  async cancelAllJobsForWorker(workerName: string) {
    const activeMarkedJobs = await this.jobStore.getActiveMarkedJobs()
    activeMarkedJobs
      .filter((job) => job.workerName === workerName)
      .map((job) => this.cancelJob(job.id))
  }

  async removeAllJobsForWorker(workerName: string) {
    this.cancelAllJobsForWorker(workerName)
    await this.jobStore.removeJobsByWorkerName(workerName)
  }

  private resetActiveJob = async (job: RawJob) => {
    this.jobStore.updateJob({ ...job, ...{ active: FALSE } })
  }

  private async resetActiveJobs() {
    const activeMarkedJobs = await this.jobStore.getActiveMarkedJobs()
    const resetTasks = activeMarkedJobs.map(this.resetActiveJob)
    await Promise.all(resetTasks)
  }

  private scheduleQueue() {
    this.timeoutId = setTimeout(this.runQueue, this.updateInterval)
  }

  private runQueue = async () => {
    if (!this.isActive) {
      this.finishQueue()
      return
    }
    const nextJob = await this.jobStore.getNextJob()
    if (this.isJobNotEmpty(nextJob)) {
      const nextJobs = await this.getJobsForWorker(nextJob.workerName)
      const processingJobs = nextJobs.map(async (job) => this.limitExecution(this.excuteJob, job))
      await Promise.all(processingJobs)
    } else if (!this.isExecuting()) {
      this.finishQueue()
      return
    }
    this.scheduleQueue()
  }

  private isJobNotEmpty(rawJob: RawJob | {}): rawJob is RawJob {
    return Object.keys(rawJob).length > 0
  }

  private limitExecution = async (executer: (rawJob: RawJob) => Promise<void>, rawJob: RawJob) => {
    return new Promise(async (resolve) => await this.enqueueJobExecuter(executer, resolve, rawJob))
  }

  private enqueueJobExecuter = async (
    executer: (rawJob: RawJob) => Promise<void>,
    resolve: (value?: unknown) => void,
    rawJob: RawJob,
  ) => {
    if (this.isExecuterAvailable()) {
      await this.runExecuter(executer, resolve, rawJob)
    } else {
      this.queuedJobExecuter.push(this.runExecuter.bind(null, executer, resolve, rawJob))
    }
  }

  private runExecuter = async (
    executer: (rawJob: RawJob) => Promise<void>,
    resolve: (value?: unknown) => void,
    rawJob: RawJob,
  ) => {
    try {
      await executer(rawJob)
    } finally {
      resolve()
      if (this.queuedJobExecuter.length > 0 && this.isExecuterAvailable()) {
        await this.queuedJobExecuter.shift()()
      }
    }
  }

  private isExecuterAvailable() {
    return this.concurrency <= 0 || this.activeJobCount < this.concurrency
  }

  private isExecuting() {
    return this.activeJobCount > 0
  }

  private async finishQueue() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }
    if (this.futureTimeoutId) {
      clearTimeout(this.futureTimeoutId)
    }

    // Reschedule future jobs
    const nearestJobSeconds = await this.jobStore.hasFutureJobs()

    if (this.maxFutureInterval > -1 && nearestJobSeconds > -1) {
      this.futureTimeoutId = setTimeout(
        () => this.scheduleQueue(),
        Math.min(Math.round(nearestJobSeconds) * 1000, this.maxFutureInterval),
      )
    } else {
      this.onQueueFinish(this.executedJobs)
      this.isActive = false
    }
  }

  private async getJobsForWorker(workerName: string) {
    const { isBusy, availableExecuters } = this.workers[workerName]
    if (!isBusy) {
      return await this.jobStore.getJobsForWorker(workerName, availableExecuters)
    } else {
      return await this.getJobsForAlternateWorker()
    }
  }

  private async getJobsForAlternateWorker() {
    for (const workerName of Object.keys(this.workers)) {
      const { isBusy, availableExecuters } = this.workers[workerName]
      let nextJobs: RawJob[] = []
      if (!isBusy) {
        nextJobs = await this.jobStore.getJobsForWorker(workerName, availableExecuters)
      }
      if (nextJobs.length > 0) {
        return nextJobs
      }
    }
    return []
  }

  private excuteJob = async (rawJob: RawJob) => {
    const worker = this.workers[rawJob.workerName]
    const payload = JSON.parse(rawJob.payload)
    const job = { ...rawJob, ...{ payload } }

    try {
      this.activeJobCount++
      if (!this.workers[rawJob.workerName]) {
        throw new Error(`Missing worker with name ${rawJob.workerName}`)
      }
      const promise = worker.execute(rawJob)

      this.runningJobPromises[rawJob.id] = promise
      await promise

      worker.triggerSuccess(job)

      this.jobStore.removeJob(rawJob)
    } catch (error) {
      worker.triggerFailure(job, error)
      const { attempts } = rawJob
      let { errors, failedAttempts, retryIn } = JSON.parse(rawJob.metaData)
      failedAttempts++
      let failed = ""
      if (failedAttempts >= attempts) {
        failed = new Date().toISOString()
      }
      const metaData = JSON.stringify({ errors: [...errors, error], failedAttempts, retryIn })
      this.jobStore.updateJob({
        ...rawJob,
        ...{
          active: FALSE,
          metaData,
          failed,
          scheduled_for: retryIn ? add(new Date(), retryIn).toISOString() : "now",
        },
      })
    } finally {
      delete this.runningJobPromises[job.id]
      worker.decreaseExecutionCount()
      worker.triggerCompletion(job)
      this.executedJobs.push(rawJob)
      this.activeJobCount--
    }
  }
}

export default Queue.instance
