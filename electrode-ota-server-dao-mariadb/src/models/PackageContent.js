import Sequelize from "sequelize";

export default sequelize => {
  const PackageContent = sequelize.define(
    "PackageContent",
    {
      packageHash: {
        type: Sequelize.STRING(191),
        primaryKey: true
      },
      content: Sequelize.BLOB("long")
    },
    {
      tableName: "packages_content",
      version: true
    }
  );

  return PackageContent;
};
