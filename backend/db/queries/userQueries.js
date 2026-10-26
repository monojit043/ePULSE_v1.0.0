const { pool } = require("../pool");

// Verifies credentials live against eil_employees on PC-2 (foreign table pc2_emp.users).
async function findByCredentials(employeeId, password) {
  const { rows } = await pool.query(
    `SELECT id, name, is_hod = 1 AS is_hod
     FROM pc2_emp.users
     WHERE upper(id) = upper($1) AND password_hash = $2 AND is_active = 1`,
    [employeeId.trim(), password]
  );
  return rows[0] || null;
}

// Current HOD / SGL / role state of a user, read live from PC-2 (users and
// user_role_assignments are views over eil_employees / cmp_pims_1014).
// Returns null if the user no longer exists or is deactivated.
async function loadLiveUser(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.is_hod,
            EXISTS (SELECT 1 FROM project_sgls WHERE user_id = u.id) AS is_sgl,
            ARRAY(SELECT DISTINCT role FROM user_role_assignments WHERE user_id = u.id ORDER BY role) AS roles
     FROM users u
     WHERE u.id = $1 AND u.is_active`,
    [userId]
  );
  const u = rows[0];
  if (!u) return null;
  const roles = u.roles || [];
  if (u.is_sgl && !roles.includes("SGL")) roles.push("SGL");
  return { id: u.id, name: u.name, isHod: !!u.is_hod, isSgl: u.is_sgl, roles };
}

async function findById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, is_hod FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getAllNonHOD() {
  const { rows } = await pool.query(
    `SELECT id, name FROM users WHERE is_hod = FALSE AND is_active ORDER BY name`
  );
  return rows;
}

async function getAll() {
  const { rows } = await pool.query(
    `SELECT id, name, is_hod FROM users WHERE is_active ORDER BY name`
  );
  return rows;
}

// Returns all roles a user has across all projects and units
async function getRoleAssignments(userId) {
  const { rows } = await pool.query(
    `SELECT project_id, unit_no, role
     FROM user_role_assignments
     WHERE user_id = $1`,
    [userId]
  );
  return rows;
}

// Returns roles a user has for a specific project+unit
async function getRolesForUnit(userId, projectId, unitNo) {
  const { rows } = await pool.query(
    `SELECT role FROM user_role_assignments
     WHERE user_id = $1 AND project_id = $2 AND unit_no = $3`,
    [userId, projectId, unitNo]
  );
  return rows.map((r) => r.role);
}

// Returns distinct projects a user is assigned to (via role or SGL)
async function getAssignedProjectIds(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT project_id FROM user_role_assignments WHERE user_id = $1
     UNION
     SELECT project_id FROM project_sgls WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.project_id);
}

// Returns project IDs where user has Modeller role
async function getModellerProjectIds(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT project_id FROM user_role_assignments
     WHERE user_id = $1 AND role = 'Modeller'`,
    [userId]
  );
  return rows.map((r) => r.project_id);
}

// Returns unit numbers where user has Modeller role in a specific project
async function getModellerUnitsForProject(userId, projectId) {
  const { rows } = await pool.query(
    `SELECT unit_no FROM user_role_assignments
     WHERE user_id = $1 AND project_id = $2 AND role = 'Modeller'`,
    [userId, projectId]
  );
  return rows.map((r) => r.unit_no);
}

// Returns users with a specific role in a project+unit
async function getUsersByRole(projectId, unitNo, role) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name
     FROM user_role_assignments ura
     JOIN users u ON u.id = ura.user_id
     WHERE ura.project_id = $1 AND ura.unit_no = $2 AND ura.role = $3
     ORDER BY u.name`,
    [projectId, unitNo, role]
  );
  return rows;
}

module.exports = {
  findByCredentials,
  loadLiveUser,
  findById,
  getAllNonHOD,
  getAll,
  getRoleAssignments,
  getRolesForUnit,
  getAssignedProjectIds,
  getModellerProjectIds,
  getModellerUnitsForProject,
  getUsersByRole,
};
