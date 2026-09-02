package server

import (
	"encoding/json"

	"github.com/teamvault/teamvault/internal/store"
)

func rolesFromJSON(rolesJSON string) []string {
	var roles []string
	_ = json.Unmarshal([]byte(rolesJSON), &roles)
	return roles
}

func userHasRoleJSON(rolesJSON, want string) bool {
	return hasRole(rolesFromJSON(rolesJSON), want)
}

// actorMayModifyUser returns false when a non-platform admin tries to change a platform_admin user.
func actorMayModifyUser(actorRoles []string, target store.UserRecord) bool {
	if userHasRoleJSON(target.RolesJSON, "platform_admin") && !hasRole(actorRoles, "platform_admin") {
		return false
	}
	return true
}

// actorMayChangeUserRoles is the historical name; same rule as actorMayModifyUser.
func actorMayChangeUserRoles(actorRoles []string, target store.UserRecord) bool {
	return actorMayModifyUser(actorRoles, target)
}
