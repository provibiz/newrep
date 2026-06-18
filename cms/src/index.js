'use strict';

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    const publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });

    if (!publicRole) return;

    const actionsToEnable = [
      'api::startseite.startseite.find',
      'api::leistung.leistung.find',
      'api::leistung.leistung.findOne',
    ];

    for (const action of actionsToEnable) {
      const existing = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({ where: { role: publicRole.id, action } });

      if (!existing) {
        await strapi.query('plugin::users-permissions.permission').create({
          data: { role: publicRole.id, action, enabled: true },
        });
      } else if (!existing.enabled) {
        await strapi
          .query('plugin::users-permissions.permission')
          .update({ where: { id: existing.id }, data: { enabled: true } });
      }
    }
  },
};
