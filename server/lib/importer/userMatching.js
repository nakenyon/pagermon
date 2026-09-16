function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normaliseUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function usersMatchByEmail(sourceUser, targetUsersByEmail) {
  var email = normaliseEmail(sourceUser.email);
  if (!email) return null;
  return targetUsersByEmail[email] || null;
}

function buildUserPlan(sourceUsers, targetUsers) {
  var targetUsersByEmail = {};
  var targetUsersByUsername = {};

  targetUsers.forEach(function (user) {
    var email = normaliseEmail(user.email);
    var username = normaliseUsername(user.username);
    if (email) targetUsersByEmail[email] = user;
    if (username) targetUsersByUsername[username] = user;
  });

  var warnings = [];
  var users = sourceUsers.map(function (sourceUser) {
    var emailMatch = usersMatchByEmail(sourceUser, targetUsersByEmail);
    if (emailMatch) {
      var roleWarning = sourceUser.role && emailMatch.role && sourceUser.role !== emailMatch.role;
      if (roleWarning) {
        warnings.push('User ' + sourceUser.username + ' matched ' + emailMatch.username + ' by email but roles differ; target role wins.');
      }
      return {
        sourceId: sourceUser.id,
        source: sourceUser.username,
        sourceEmail: sourceUser.email,
        action: 'merge',
        into: emailMatch.username,
        targetId: emailMatch.id,
        matchedOn: 'email',
        confidence: 'high',
        roleDifference: roleWarning ? { source: sourceUser.role, target: emailMatch.role } : undefined
      };
    }

    var usernameMatch = targetUsersByUsername[normaliseUsername(sourceUser.username)];
    if (usernameMatch) {
      var sourceEmail = normaliseEmail(sourceUser.email);
      var targetEmail = normaliseEmail(usernameMatch.email);
      if (sourceEmail && targetEmail && sourceEmail === targetEmail) {
        return {
          sourceId: sourceUser.id,
          source: sourceUser.username,
          sourceEmail: sourceUser.email,
          action: 'merge',
          into: usernameMatch.username,
          targetId: usernameMatch.id,
          matchedOn: 'username',
          confidence: 'high'
        };
      }
      warnings.push('User ' + sourceUser.username + ' requires review: username matches existing user but email differs.');
      return {
        sourceId: sourceUser.id,
        source: sourceUser.username,
        sourceEmail: sourceUser.email,
        action: 'REVIEW',
        reason: 'username matches existing user, email differs',
        candidates: [usernameMatch.username],
        existingEmail: usernameMatch.email,
        confidence: 'manual'
      };
    }

    return {
      sourceId: sourceUser.id,
      source: sourceUser.username,
      sourceEmail: sourceUser.email,
      action: 'create',
      confidence: 'high'
    };
  });

  return { users: users, warnings: warnings };
}

module.exports = {
  buildUserPlan: buildUserPlan,
  normaliseEmail: normaliseEmail,
  normaliseUsername: normaliseUsername
};
