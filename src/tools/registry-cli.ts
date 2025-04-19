#!/usr/bin/env bun
/**
 * 阿里雲容器鏡像倉庫 CLI 工具
 *
 * 這個工具提供了命令行界面來管理阿里雲容器鏡像倉庫
 *
 * 用法:
 *   bun run src/tools/registry-cli.ts <command> [options]
 *
 * 命令:
 *   login                     登錄到阿里雲容器鏡像倉庫
 *   list [namespace] [repo]   列出阿里雲容器鏡像倉庫中的鏡像
 *   tags <namespace> <repo>   列出阿里雲容器鏡像倉庫中的標籤
 *   delete <namespace> <repo> <tag>  刪除阿里雲容器鏡像倉庫中的鏡像
 *   push <local> <namespace> <repo> [tag]  推送鏡像到阿里雲容器鏡像倉庫
 *   pull <namespace> <repo> [tag]  拉取鏡像從阿里雲容器鏡像倉庫
 *   build-push <dockerfile> <namespace> <repo> [tag]  構建並推送鏡像
 */

import { DockerRegistry } from "@/env/env-manager";
import { exec } from "child_process";
import { promisify } from "util";

// 將 exec 轉換為 Promise 版本
const execAsync = promisify(exec);

// 阿里雲容器鏡像倉庫配置
const REGISTRY_USERNAME = DockerRegistry.username;
const REGISTRY_PASSWORD = DockerRegistry.password;
const REGISTRY_URL = DockerRegistry.registry;

/**
 * 執行 shell 命令並輸出結果
 */
async function runCommand(command: string): Promise<void> {
    try {
        console.log(`執行命令: ${command}`);
        const { stdout, stderr } = await execAsync(command);

        if (stdout) {
            console.log(stdout);
        }

        if (stderr) {
            console.error(stderr);
        }
    } catch (error) {
        console.error("命令執行失敗:", error);
        process.exit(1);
    }
}

/**
 * 登錄到阿里雲容器鏡像倉庫
 */
async function login(): Promise<void> {
    await runCommand(`docker login --username=${REGISTRY_USERNAME} -p ${REGISTRY_PASSWORD} ${REGISTRY_URL}`);
}

/**
 * 登出阿里雲容器鏡像倉庫
 */
async function logout(): Promise<void> {
    await runCommand(`docker logout ${REGISTRY_URL}`);
}

/**
 * 列出阿里雲容器鏡像倉庫中的鏡像
 */
async function listImages(namespace?: string, repository?: string): Promise<void> {
    let command = `docker search ${REGISTRY_URL}`;

    if (namespace) {
        command += `/${namespace}`;
        if (repository) {
            command += `/${repository}`;
        }
    }

    command += ` --format "table {{.Name}}\t{{.Description}}\t{{.StarCount}}"`;

    await runCommand(command);
}

/**
 * 列出阿里雲容器鏡像倉庫中的標籤
 */
async function listTags(namespace: string, repository: string): Promise<void> {
    const authHeader = Buffer.from(`${REGISTRY_USERNAME}:${REGISTRY_PASSWORD}`).toString('base64');

    await runCommand(`curl -s -H "Authorization: Basic ${authHeader}" https://${REGISTRY_URL}/v2/${namespace}/${repository}/tags/list | jq -r '.tags[]'`);
}

/**
 * 刪除阿里雲容器鏡像倉庫中的鏡像
 */
async function deleteImage(namespace: string, repository: string, tag: string): Promise<void> {
    console.log(`刪除鏡像: ${namespace}/${repository}:${tag}`);

    // 獲取鏡像摘要
    const authHeader = Buffer.from(`${REGISTRY_USERNAME}:${REGISTRY_PASSWORD}`).toString('base64');

    try {
        const { stdout } = await execAsync(`curl -s -H "Authorization: Basic ${authHeader}" -H "Accept: application/vnd.docker.distribution.manifest.v2+json" -I https://${REGISTRY_URL}/v2/${namespace}/${repository}/manifests/${tag}`);

        // 從 HTTP 頭中提取 Docker-Content-Digest
        const digestMatch = stdout.match(/Docker-Content-Digest: (sha256:[a-f0-9]+)/i);
        if (!digestMatch || !digestMatch[1]) {
            console.error("錯誤: 無法獲取鏡像摘要");
            process.exit(1);
        }

        const digest = digestMatch[1];
        console.log(`鏡像摘要: ${digest}`);

        // 刪除鏡像
        await runCommand(`curl -s -X DELETE -H "Authorization: Basic ${authHeader}" https://${REGISTRY_URL}/v2/${namespace}/${repository}/manifests/${digest}`);

        console.log("鏡像已刪除");
    } catch (error) {
        console.error("刪除鏡像失敗:", error);
        process.exit(1);
    }
}

/**
 * 推送鏡像到阿里雲容器鏡像倉庫
 */
async function pushImage(localImage: string, namespace: string, repository: string, tag: string = "latest"): Promise<void> {
    console.log(`推送鏡像: ${localImage} -> ${namespace}/${repository}:${tag}`);

    // 標記本地鏡像
    await runCommand(`docker tag ${localImage} ${REGISTRY_URL}/${namespace}/${repository}:${tag}`);

    // 推送鏡像
    await runCommand(`docker push ${REGISTRY_URL}/${namespace}/${repository}:${tag}`);
}

/**
 * 拉取鏡像從阿里雲容器鏡像倉庫
 */
async function pullImage(namespace: string, repository: string, tag: string = "latest"): Promise<void> {
    await runCommand(`docker pull ${REGISTRY_URL}/${namespace}/${repository}:${tag}`);
}

/**
 * 構建並推送鏡像到阿里雲容器鏡像倉庫
 */
async function buildAndPushImage(dockerfile: string, namespace: string, repository: string, tag: string = "latest"): Promise<void> {
    console.log(`構建並推送鏡像: ${dockerfile} -> ${namespace}/${repository}:${tag}`);

    // 構建鏡像
    await runCommand(`docker build -t ${REGISTRY_URL}/${namespace}/${repository}:${tag} -f ${dockerfile} .`);

    // 推送鏡像
    await runCommand(`docker push ${REGISTRY_URL}/${namespace}/${repository}:${tag}`);
}

/**
 * 顯示幫助信息
 */
function showHelp(): void {
    console.log(`
阿里雲容器鏡像倉庫 CLI 工具

用法:
  bun run src/tools/registry-cli.ts <command> [options]

命令:
  login                     登錄到阿里雲容器鏡像倉庫
  logout                    登出阿里雲容器鏡像倉庫
  list [namespace] [repo]   列出阿里雲容器鏡像倉庫中的鏡像
  tags <namespace> <repo>   列出阿里雲容器鏡像倉庫中的標籤
  delete <namespace> <repo> <tag>  刪除阿里雲容器鏡像倉庫中的鏡像
  push <local> <namespace> <repo> [tag]  推送鏡像到阿里雲容器鏡像倉庫
  pull <namespace> <repo> [tag]  拉取鏡像從阿里雲容器鏡像倉庫
  build-push <dockerfile> <namespace> <repo> [tag]  構建並推送鏡像
  help                      顯示幫助信息
`);
}

/**
 * 主函數
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command || command === "help") {
        showHelp();
        return;
    }

    switch (command) {
        case "login":
            await login();
            break;

        case "logout":
            await logout();
            break;

        case "list":
            await listImages(args[1], args[2]);
            break;

        case "tags":
            if (args.length < 3) {
                console.error("錯誤: 缺少參數");
                console.error("用法: tags <namespace> <repo>");
                process.exit(1);
            }
            await listTags(args[1], args[2]);
            break;

        case "delete":
            if (args.length < 4) {
                console.error("錯誤: 缺少參數");
                console.error("用法: delete <namespace> <repo> <tag>");
                process.exit(1);
            }
            await deleteImage(args[1], args[2], args[3]);
            break;

        case "push":
            if (args.length < 4) {
                console.error("錯誤: 缺少參數");
                console.error("用法: push <local> <namespace> <repo> [tag]");
                process.exit(1);
            }
            await pushImage(args[1], args[2], args[3], args[4] || "latest");
            break;

        case "pull":
            if (args.length < 3) {
                console.error("錯誤: 缺少參數");
                console.error("用法: pull <namespace> <repo> [tag]");
                process.exit(1);
            }
            await pullImage(args[1], args[2], args[3] || "latest");
            break;

        case "build-push":
            if (args.length < 4) {
                console.error("錯誤: 缺少參數");
                console.error("用法: build-push <dockerfile> <namespace> <repo> [tag]");
                process.exit(1);
            }
            await buildAndPushImage(args[1], args[2], args[3], args[4] || "latest");
            break;

        default:
            console.error(`錯誤: 未知命令 "${command}"`);
            showHelp();
            process.exit(1);
    }
}

// 執行主函數
main().catch(error => {
    console.error("程序執行失敗:", error);
    process.exit(1);
});