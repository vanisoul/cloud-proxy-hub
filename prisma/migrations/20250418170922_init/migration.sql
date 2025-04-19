-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Instance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "ip" TEXT,
    "start" BOOLEAN NOT NULL DEFAULT false,
    "docker" BOOLEAN NOT NULL DEFAULT false,
    "dockerStep" INTEGER NOT NULL DEFAULT 0,
    "dockerStepTotal" INTEGER NOT NULL DEFAULT 0,
    "socks" BOOLEAN NOT NULL DEFAULT false,
    "socksStep" INTEGER NOT NULL DEFAULT 0,
    "socksStepTotal" INTEGER NOT NULL DEFAULT 0,
    "ipsecVpn" BOOLEAN NOT NULL DEFAULT false,
    "ipsecVpnStep" INTEGER NOT NULL DEFAULT 0,
    "ipsecVpnStepTotal" INTEGER NOT NULL DEFAULT 0,
    "ipsecPsk" TEXT NOT NULL DEFAULT '',
    "ipsecUser" TEXT NOT NULL DEFAULT '',
    "ipsecPwd" TEXT NOT NULL DEFAULT ''
);
