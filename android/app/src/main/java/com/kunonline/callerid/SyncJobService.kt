package com.kunonline.callerid

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import kotlin.concurrent.thread

class SyncJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        thread(name = "kun-caller-sync") {
            runCatching { KunApi.syncWithStoredSession(this) }
            jobFinished(params, false)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    companion object {
        private const val JOB_ID = 24091
        private const val PERIOD_MS = 60L * 60L * 1000L

        fun schedule(context: Context): Boolean = runCatching {
            val scheduler = context.getSystemService(JobScheduler::class.java) ?: return@runCatching false
            val job = JobInfo.Builder(JOB_ID, ComponentName(context, SyncJobService::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(PERIOD_MS)
                .build()
            scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS
        }.getOrDefault(false)

        fun cancel(context: Context) {
            runCatching { context.getSystemService(JobScheduler::class.java)?.cancel(JOB_ID) }
        }
    }
}
