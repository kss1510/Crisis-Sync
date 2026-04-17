import mongoose from 'mongoose';
import { Incident, INCIDENT_STATUSES, EMERGENCY_TYPES, DEPARTMENTS } from '../models/Incident.js';
import { Room } from '../models/Room.js';
import { Floor } from '../models/Floor.js';
import { AppError } from '../middleware/errorHandler.js';
import { computeIncidentPriority } from '../utils/priority.js';
import { getSuggestionsForType } from './aiService.js';
import { recordAudit } from './auditService.js';
import { createNotification, notifyIncidentStakeholders } from './notificationService.js';
import { emitNewIncident, emitNewIncidentToUser, emitIncidentUpdated, emitStatusChanged, emitNotificationToUser } from '../sockets/socketHub.js';

const ORDER = { Pending: 0, 'In Progress': 1, Resolved: 2 };

function assertValidStatusTransition(from, to) {
  if (from === to) return;
  if (!INCIDENT_STATUSES.includes(to)) throw new AppError('Invalid status', 400);
  if (ORDER[to] < ORDER[from]) {
    throw new AppError('Invalid status transition: cannot revert to a less advanced state', 400);
  }
  if (ORDER[to] - ORDER[from] > 1) {
    throw new AppError('Invalid status transition: statuses must advance sequentially', 400);
  }
}

async function ensureLocation(floorId, roomId) {
  if (!mongoose.isValidObjectId(floorId) || !mongoose.isValidObjectId(roomId)) {
    throw new AppError('Invalid floor or room id', 400);
  }
  const [floor, room] = await Promise.all([Floor.findById(floorId), Room.findById(roomId).populate('floor')]);
  if (!floor) throw new AppError('Floor not found', 404);
  if (!room) throw new AppError('Room not found', 404);
  if (room.floor._id.toString() !== floor._id.toString()) {
    throw new AppError('Room is not on the selected floor', 400);
  }
  return { floor, room };
}

export async function createIncident(
  {
    emergencyType,
    department = 'Security',
    floorId,
    roomId,
    title,
    description,
    triggeredByUserId,
    sosSource = 'sos_panel',
  },
  { ioEnabled = true } = {}
) {
  if (!EMERGENCY_TYPES.includes(emergencyType)) {
    throw new AppError('Invalid emergency type', 400);
  }
  if (!DEPARTMENTS.includes(department)) {
    throw new AppError('Invalid department', 400);
  }
  await ensureLocation(floorId, roomId);
  const ai = await getSuggestionsForType(emergencyType);
  const priority = computeIncidentPriority(emergencyType, ai.priorityWeight || 1);

  const doc = await Incident.create({
    emergencyType,
    department,
    priority,
    floor: floorId,
    room: roomId,
    triggeredBy: triggeredByUserId,
    title: title || `${emergencyType} SOS`,
    description: description || '',
    sosSource,
    status: 'Pending',
  });

  const populated = await Incident.findById(doc._id)
    .populate('triggeredBy', 'name email role')
    .populate('assignedTo', 'name email role')
    .populate('floor', 'label level building')
    .populate('room', 'name code');

  await recordAudit({
    actorId: triggeredByUserId,
    action: 'incident.created',
    resourceId: doc._id,
    details: `Created ${emergencyType} incident`,
    metadata: { emergencyType, department, priority, floorId, roomId },
  });

  const locationStr = [populated.floor?.label, populated.room?.name].filter(Boolean).join(', ') || 'Unknown Location';
  const notifications = await notifyIncidentStakeholders({
    title: `New ${emergencyType} incident`,
    body: `Location: ${locationStr}\nTitle: ${populated.title}\nDetails: ${description || 'No additional details provided.'}`,
    incidentId: doc._id,
    meta: { priority, status: doc.status, department },
    department,
  });

  if (ioEnabled) {
    for (const n of notifications) {
      const plain = typeof n.toObject === 'function' ? n.toObject() : n;
      const userIdStr = String(plain.user);
      emitNewIncidentToUser(userIdStr, { incident: populated.toObject(), ackId: doc._id.toString() });
      emitNotificationToUser(userIdStr, { notification: plain });
    }
  }

  return populated;
}

export async function listIncidents({ type, status, sort = '-createdAt', limit = 100, skip = 0 }) {
  const q = {};
  if (type) q.emergencyType = type;
  if (status) q.status = status;
  const lim = Math.min(Number(limit) || 100, 200);
  const sk = Math.min(Number(skip) || 0, 10000);
  const [items, total] = await Promise.all([
    Incident.find(q)
      .sort(sort)
      .skip(sk)
      .limit(lim)
      .populate('triggeredBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .populate('floor', 'label level building')
      .populate('room', 'name code'),
    Incident.countDocuments(q),
  ]);
  return { items, total };
}

export async function getIncidentById(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid incident id', 400);
  const doc = await Incident.findById(id)
    .populate('triggeredBy', 'name email role')
    .populate('assignedTo', 'name email role')
    .populate('floor', 'label level building')
    .populate('room', 'name code')
    .populate('notes.user', 'name email role');
  if (!doc) throw new AppError('Incident not found', 404);
  return doc;
}

export async function updateIncident(
  id,
  { status, assignedTo, department, noteText, actorUserId, actorRole },
  { ioEnabled = true } = {}
) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid incident id', 400);
  const incident = await Incident.findById(id);
  if (!incident) throw new AppError('Incident not found', 404);

  if (actorRole === 'Staff') {
    if (status || assignedTo !== undefined || department !== undefined) {
      throw new AppError('Staff may only add notes to incidents', 403);
    }
  }

  const prevStatus = incident.status;
  const prevAssigneeId = incident.assignedTo ? incident.assignedTo.toString() : null;
  const prevDepartment = incident.department;

  if (status) {
    assertValidStatusTransition(incident.status, status);
    incident.status = status;
    if (status === 'Resolved') {
      incident.resolvedAt = new Date();
    }
  }
  
  if (department && department !== incident.department) {
    incident.department = department;
  }

  if (assignedTo !== undefined) {
    if (assignedTo === null || assignedTo === '') {
      incident.assignedTo = null;
    } else {
      if (!mongoose.isValidObjectId(assignedTo)) throw new AppError('Invalid assignee id', 400);
      incident.assignedTo = assignedTo;
    }
  }

  if (!incident.firstResponseAt && (incident.status === 'In Progress' || incident.assignedTo)) {
    incident.firstResponseAt = new Date();
  }

  if (noteText && String(noteText).trim()) {
    incident.notes.push({ user: actorUserId, text: String(noteText).trim() });
  }

  await incident.save();

  const populated = await getIncidentById(incident._id);
  const newAssigneeId = incident.assignedTo ? incident.assignedTo.toString() : null;
  const assigneeChanged = assignedTo !== undefined && newAssigneeId !== prevAssigneeId;
  const departmentChanged = department && department !== prevDepartment;

  await recordAudit({
    actorId: actorUserId,
    action: 'incident.updated',
    resourceId: incident._id,
    details: `Updated incident${status ? ` status ${prevStatus}→${status}` : ''}${departmentChanged ? ` department ${prevDepartment}→${department}` : ''}${assigneeChanged ? '; assignee changed' : ''}${noteText ? '; note added' : ''}`,
    metadata: { prevStatus, status: incident.status, prevDepartment, department: incident.department },
  });

  if (assigneeChanged && newAssigneeId) {
    const n = await createNotification({
      userId: newAssigneeId,
      title: 'Incident assigned to you',
      body: `${incident.emergencyType} at priority ${incident.priority}`,
      incidentId: incident._id,
      meta: { type: 'assignment' },
    });
    if (ioEnabled) emitNotificationToUser(newAssigneeId, { notification: n.toObject() });
  }
  
  if (departmentChanged) {
      const locationStr = [populated.floor?.label, populated.room?.name].filter(Boolean).join(', ') || 'Unknown Location';
      const departmentNotifications = await notifyIncidentStakeholders({
         title: `Incident re-assigned to your department`,
         body: `Location: ${locationStr}\nTitle: ${populated.title}`,
         incidentId: incident._id,
         meta: { type: 'assignment', department: incident.department },
         department: incident.department
      });
      if (ioEnabled) {
        for (const n of departmentNotifications) {
          const plain = typeof n.toObject === 'function' ? n.toObject() : n;
          emitNotificationToUser(String(plain.user), { notification: plain });
        }
      }
  }

  if (ioEnabled) {
    emitIncidentUpdated({ incident: populated.toObject(), ackId: incident._id.toString() });
    if (status && status !== prevStatus) {
      emitStatusChanged({
        incidentId: incident._id.toString(),
        from: prevStatus,
        to: status,
        at: new Date().toISOString(),
        ackId: incident._id.toString(),
      });
    }
  }

  return populated;
}

export async function deleteIncident(id, actorUserId, { ioEnabled = true } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid incident id', 400);
  const incident = await Incident.findByIdAndDelete(id);
  if (!incident) throw new AppError('Incident not found', 404);
  await recordAudit({
    actorId: actorUserId,
    action: 'incident.deleted',
    resourceId: incident._id,
    details: 'Incident deleted',
  });
  if (ioEnabled) {
    emitIncidentUpdated({ incident: { id: incident._id.toString(), deleted: true }, ackId: incident._id.toString() });
  }
  return { ok: true };
}
