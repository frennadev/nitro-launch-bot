/**
 * REST API Endpoints for CTO Progress Tracking
 * Provides HTTP endpoints for frontend applications to track CTO operations
 */

import { Router } from "express";
import {
  getCTOJobStatus,
  subscribeToProgress,
  getCTOProgressStats,
} from "../jobs/cto-external";

export const ctoProgressRouter = Router();

/**
 * GET /api/cto/job/:jobId/status
 * Get comprehensive status and progress for a CTO job
 */
ctoProgressRouter.get("/job/:jobId/status", async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await getCTOJobStatus(jobId);

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/cto/jobs/stats
 * Get progress statistics for multiple jobs
 * Query params: jobIds (comma-separated list)
 */
ctoProgressRouter.get("/jobs/stats", async (req, res) => {
  try {
    const { jobIds } = req.query;

    if (!jobIds || typeof jobIds !== "string") {
      return res.status(400).json({
        success: false,
        error: "jobIds query parameter is required",
      });
    }

    const jobIdArray = jobIds.split(",").map((id) => id.trim());
    const stats = await getCTOProgressStats(jobIdArray);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/cto/job/:jobId/events
 * Get all progress events for a specific job
 */
ctoProgressRouter.get("/job/:jobId/events", async (req, res) => {
  try {
    const { jobId } = req.params;

    // Import progress tracker dynamically
    const { ctoProgressStore } = await import("../jobs/cto-progress-tracker");
    const events = ctoProgressStore.getProgressEvents(jobId);

    res.json({
      success: true,
      data: {
        jobId,
        events,
        totalEvents: events.length,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/cto/job/:jobId/latest
 * Get the latest progress event for a job
 */
ctoProgressRouter.get("/job/:jobId/latest", async (req, res) => {
  try {
    const { jobId } = req.params;

    // Import progress tracker dynamically
    const { ctoProgressStore } = await import("../jobs/cto-progress-tracker");
    const latestProgress = ctoProgressStore.getLatestProgress(jobId);

    if (!latestProgress) {
      return res.status(404).json({
        success: false,
        error: "No progress data found for this job",
      });
    }

    res.json({
      success: true,
      data: latestProgress,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/cto/job/:jobId/result
 * Get the final operation result for a completed job
 */
ctoProgressRouter.get("/job/:jobId/result", async (req, res) => {
  try {
    const { jobId } = req.params;

    // Import progress tracker dynamically
    const { ctoProgressStore } = await import("../jobs/cto-progress-tracker");
    const result = ctoProgressStore.getOperationResult(jobId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "No result data found for this job (job may not be completed)",
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * WebSocket endpoint information
 * GET /api/cto/websocket/info
 */
ctoProgressRouter.get("/websocket/info", (req, res) => {
  res.json({
    success: true,
    data: {
      socketIOEndpoint: process.env.SOCKET_IO_URL || "ws://localhost:3000",
      events: {
        progress: "worker_progress",
        completed: "worker_completed",
      },
      rooms: {
        userSpecific: "user_{userId}",
        admin: "admin_launches",
      },
      usage: {
        connect: "Connect to Socket.IO server",
        joinRoom: "Join user-specific room for updates",
        listenProgress: "Listen to 'worker_progress' events",
        filterCTO: "Filter events by 'workerType: cto_operation'",
      },
    },
  });
});

export default ctoProgressRouter;
