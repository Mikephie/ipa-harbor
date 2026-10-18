const { isValidAppleAccountId } = require('../../utils/appleAccount');

function filterTasksForAccount(tasks, accountId) {
    if (!isValidAppleAccountId(accountId)) {
        return [];
    }

    return [...(tasks || [])]
        .filter((task) => task && task.accountId === accountId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
    filterTasksForAccount,
};
