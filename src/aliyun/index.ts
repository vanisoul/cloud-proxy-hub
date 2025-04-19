import * as OpenApiLib from "@alicloud/openapi-client";
import ECSClient, * as ECSClientLib from "@alicloud/ecs20140526";
import * as Util from "@alicloud/tea-util";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "@/utils/logger";

import {
  accessKeyId,
  accessKeySecret,
  endpoint,
  getConnectTimeout,
  internetMaxBandwidthOut,
  regionId,
  securityGroupId,
  vSwitchId,
  diskSize,
  diskCategory,
  imageId,
  instanceType,
  internetChargeType,
  instanceChargeType,
  chargePeriod,
  chargePeriodUnit,
  securityStrategy,
  instanceNamePrefix,
  commandType,
  commandWorkingDir,
  commandRepeatMode,
  commandContentEncoding,
  commandTimeout,
  commandInitialWaitTime,
  commandPollingWaitTime,
  tcpUdpPortRange,
  icmpPortRange
} from "@/env/env-manager";

// 創建日誌記錄器
const logger = createLogger("aliyun");

// 建立一個阿里雲客戶端對象
class Client {
  private client: ECSClient;
  private regionId: string;
  private connectTimeout = getConnectTimeout();

  constructor(
    accessKeyId: string,
    accessKeySecret: string,
    endpoint: string,
    regionId: string,
  ) {
    const config = new OpenApiLib.Config({
      // 必填，您的 AccessKey ID
      accessKeyId: accessKeyId,
      // 必填，您的 AccessKey Secret
      accessKeySecret: accessKeySecret,
      // Endpoint 请参考 https://api.aliyun.com/product/Ecs
      endpoint: endpoint,
    });

    this.client = new ECSClient(config);
    this.regionId = regionId;
    logger.info("阿里雲客戶端初始化完成", { regionId, endpoint });
  }

  // 查詢目前所有的ECS實例
  async describeInstances(): Promise<
    ECSClientLib.DescribeInstancesResponseBody
  > {
    logger.info("查詢所有 ECS 實例");
    const describeInstancesRequest = new ECSClientLib.DescribeInstancesRequest({
      regionId: this.regionId,
    });

    const runtime = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    const resp = await this.client.describeInstancesWithOptions(
      describeInstancesRequest,
      runtime,
    );

    logger.debug("查詢所有 ECS 實例完成", {
      instanceCount: resp.body.instances?.instance?.length || 0
    });
    return resp.body;
  }

  // 根據 id 查詢 ECS 實例 為 status: "Stopped"
  async describeStoppedInstance(id: string): Promise<boolean> {
    logger.info("檢查實例是否已停止", { id });
    const status = await this.describeInstanceStatus(id);
    const stopped = status === "Stopped";
    logger.debug("實例停止狀態檢查結果", { id, status, stopped });
    return stopped;
  }

  // 根據 id 查詢 ECS 實例 為 status: "Running"
  async describeRunningInstance(id: string): Promise<boolean> {
    logger.info("檢查實例是否正在運行", { id });
    const status = await this.describeInstanceStatus(id);
    const running = status === "Running";
    logger.debug("實例運行狀態檢查結果", { id, status, running });
    return running;
  }

  // 根據 id 查看 ECS 實例 狀態
  async describeInstanceStatus(
    id: string,
  ): Promise<string> {
    logger.info("獲取實例狀態", { id });
    const describeInstancesRequest = new ECSClientLib
      .DescribeInstanceStatusRequest({
        regionId: this.regionId,
        instanceId: [id],
      });

    const runtime = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    const resp = await this.client.describeInstanceStatusWithOptions(
      describeInstancesRequest,
      runtime,
    );
    const status = resp.body.instanceStatuses?.instanceStatus
      ?.[0].status;

    logger.debug("獲取實例狀態完成", { id, status: status || "未知" });
    return status ?? "";
  }

  // 根據 id 查詢 ECS 實例
  async describeInstance(
    id: string,
  ): Promise<ECSClientLib.DescribeInstancesResponseBody> {
    logger.info("查詢指定實例詳情", { id });
    const describeInstancesRequest = new ECSClientLib.DescribeInstancesRequest({
      regionId: this.regionId,
      instanceIds: [id],
    });

    const runtime = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    const resp = await this.client.describeInstancesWithOptions(
      describeInstancesRequest,
      runtime,
    );
    logger.debug("查詢指定實例詳情完成", { id });
    return resp.body;
  }

  // 建立一個ECS實例
  async createInstance(): Promise<
    { instanceName: string; instanceId: string | undefined }
  > {
    logger.info("開始創建 ECS 實例");

    const instanceUUIDv4 = uuidv4();
    const instanceName = `${instanceNamePrefix}${instanceUUIDv4}`;
    logger.debug("生成實例名稱", { instanceName });

    const reqDisk = new ECSClientLib.CreateInstanceRequestDataDisk({
      size: diskSize,
      category: diskCategory,
    });

    const reqInstance = new ECSClientLib.CreateInstanceRequest({
      regionId: this.regionId,
      imageId: imageId,
      instanceName,
      instanceType: instanceType,
      internetChargeType: internetChargeType,
      internetMaxBandwidthOut,
      systemDisk: reqDisk,
      instanceChargeType: instanceChargeType,
      period: chargePeriod,
      periodUnit: chargePeriodUnit,
      securityEnhancementStrategy: securityStrategy,
      vSwitchId: vSwitchId,
      dryRun: false,
      securityGroupId,
    });

    const createInstanceRequest = new ECSClientLib.CreateInstanceRequest(
      reqInstance,
    );

    const runtime = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    const resp = await this.client.createInstanceWithOptions(
      createInstanceRequest,
      runtime,
    );

    logger.info("ECS 實例創建成功", {
      instanceName,
      instanceId: resp.body.instanceId,
      requestId: resp.body.requestId
    });
    return { instanceName, instanceId: resp.body.instanceId };
  }

  // 清空原安全組規則
  async revokeSecurityGroup() {
    logger.info("開始清空安全組規則", { securityGroupId });
    const describeSecurityGroupAttributeRequest = new ECSClientLib
      .DescribeSecurityGroupAttributeRequest({
        securityGroupId: securityGroupId,
        regionId: this.regionId,
      });

    const runtime = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    const describeSecurityGroupAttributeRespond = await this.client
      .describeSecurityGroupAttributeWithOptions(
        describeSecurityGroupAttributeRequest,
        runtime,
      );

    const securityGroupAttribute = describeSecurityGroupAttributeRespond.body
      .permissions?.permission;

    if (securityGroupAttribute) {
      logger.debug("找到安全組規則", { ruleCount: securityGroupAttribute.length });
      for (const rule of securityGroupAttribute) {
        logger.debug("撤銷安全組規則", {
          ipProtocol: rule.ipProtocol,
          portRange: rule.portRange,
          sourceCidrIp: rule.sourceCidrIp
        });

        const revokeSecurityGroupRequest = new ECSClientLib
          .RevokeSecurityGroupRequest({
            regionId: this.regionId,
            ipProtocol: rule.ipProtocol,
            portRange: rule.portRange,
            sourceCidrIp: rule.sourceCidrIp,
            securityGroupId: securityGroupId,
          });

        const runtime = new Util.RuntimeOptions({
          connectTimeout: this.connectTimeout,
          readTimeout: this.connectTimeout,
        });

        await this.client.revokeSecurityGroupWithOptions(
          revokeSecurityGroupRequest,
          runtime,
        );
      }
    } else {
      logger.debug("安全組中沒有規則");
    }

    logger.info("安全組規則清空完成");
  }

  // 設定安全組規則 都為最優先 1, 第一個參數為 TCP 開/關, 第二個參數為 UDP 開/關, 第三個參數為 icmp 開/關, 第四個參數為 目標 IP
  async authorizeSecurityGroup(
    openTcp: boolean,
    openUdp: boolean,
    openIcmp: boolean,
    ip: string,
  ) {
    logger.info("開始設定安全組規則", {
      securityGroupId,
      ip,
      openTcp,
      openUdp,
      openIcmp
    });

    if (openTcp) {
      logger.debug("添加 TCP 規則", { ip });
      const authorizeSecurityGroupRequest = new ECSClientLib
        .AuthorizeSecurityGroupRequest({
          regionId: this.regionId,
          ipProtocol: "TCP",
          portRange: tcpUdpPortRange,
          sourceCidrIp: ip,
          securityGroupId: securityGroupId,
        });

      const runtime = new Util.RuntimeOptions({
        connectTimeout: this.connectTimeout,
        readTimeout: this.connectTimeout,
      });

      await this.client.authorizeSecurityGroupWithOptions(
        authorizeSecurityGroupRequest,
        runtime,
      );
    }

    if (openUdp) {
      logger.debug("添加 UDP 規則", { ip });
      const authorizeSecurityGroupRequest = new ECSClientLib
        .AuthorizeSecurityGroupRequest({
          regionId: this.regionId,
          ipProtocol: "UDP",
          portRange: tcpUdpPortRange,
          sourceCidrIp: ip,
          securityGroupId: securityGroupId,
        });

      const runtime = new Util.RuntimeOptions({
        connectTimeout: this.connectTimeout,
        readTimeout: this.connectTimeout,
      });

      await this.client.authorizeSecurityGroupWithOptions(
        authorizeSecurityGroupRequest,
        runtime,
      );
    }

    if (openIcmp) {
      logger.debug("添加 ICMP 規則", { ip });
      const authorizeSecurityGroupRequest = new ECSClientLib
        .AuthorizeSecurityGroupRequest({
          regionId: this.regionId,
          ipProtocol: "ICMP",
          portRange: icmpPortRange,
          sourceCidrIp: ip,
          securityGroupId: securityGroupId,
        });

      const runtime = new Util.RuntimeOptions({
        connectTimeout: this.connectTimeout,
        readTimeout: this.connectTimeout,
      });

      await this.client.authorizeSecurityGroupWithOptions(
        authorizeSecurityGroupRequest,
        runtime,
      );
    }

    logger.info("安全組規則設定完成");
    return { success: true, ip };
  }

  // 根據ID刪除ECS實例
  async deleteInstance(ids: string[]): Promise<any> {
    logger.info("開始刪除 ECS 實例", { count: ids.length, ids });

    if (ids.length === 0) {
      logger.warn("沒有指定要刪除的實例");
      return { msg: "instanceIds is empty" };
    }

    try {
      const deleteInstanceRequest = new ECSClientLib.DeleteInstancesRequest({
        regionId: this.regionId,
        instanceId: ids,
        force: true,
      });

      const runtime = new Util.RuntimeOptions({
        connectTimeout: this.connectTimeout,
        readTimeout: this.connectTimeout,
      });

      const resp = await this.client.deleteInstancesWithOptions(
        deleteInstanceRequest,
        runtime,
      );

      logger.info("ECS 實例刪除成功", { count: ids.length, ids });
      return resp.body;
    } catch (error: unknown) {
      const errorCode = (error as { code: string }).code;
      logger.error("ECS 實例刪除失敗", {
        count: ids.length,
        ids,
        errorCode,
        error: error instanceof Error ? error.message : String(error)
      });
      return errorCode;
    }
  }

  // 根據ID啟動ECS實例
  async startInstance(
    id: string,
  ): Promise<ECSClientLib.StartInstanceResponseBody> {
    logger.info("開始啟動 ECS 實例", { id });

    const startInstanceRequest = new ECSClientLib.StartInstanceRequest({
      instanceId: id,
    });

    const runtime = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    const resp = await this.client.startInstanceWithOptions(
      startInstanceRequest,
      runtime,
    );

    logger.info("ECS 實例啟動成功", { id });
    return resp.body;
  }

  // 根據ID 取得 IP 位置
  async getInstanceIp(id: string): Promise<string | undefined> {
    logger.info("開始獲取 ECS 實例 IP", { id });

    const describeInstancesRequest = new ECSClientLib
      .AllocatePublicIpAddressRequest({
        regionId: this.regionId,
        instanceId: id,
      });

    const runtime = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    const resp = await this.client.allocatePublicIpAddressWithOptions(
      describeInstancesRequest,
      runtime,
    );

    // 取得第一個 instance 的第一個 publicIpAddress
    logger.info("獲取 ECS 實例 IP 成功", { id, ip: resp.body.ipAddress });
    return resp.body.ipAddress;
  }

  // 根據ID 執行指令
  async runCommand(
    id: string,
    command: string,
  ): Promise<{ success: boolean; msg: string }> {
    logger.info("開始在 ECS 實例上執行命令", { id });
    logger.debug("執行命令詳情", { id, command });

    // 執行命令
    const invokeCommandRequest = new ECSClientLib.RunCommandRequest({
      regionId: this.regionId,
      type: commandType,
      commandContent: command,
      workingDir: commandWorkingDir,
      repeatMode: commandRepeatMode,
      instanceId: [
        id,
      ],
      contentEncoding: commandContentEncoding,
      timeout: commandTimeout,
    });

    const runtime = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    const resp = await this.client.runCommandWithOptions(
      invokeCommandRequest,
      runtime,
    );

    logger.debug("命令提交成功，等待執行結果", { id, invokeId: resp.body.invokeId });

    // 迴圈呼叫 DescribeInvocationsRequest API, 直到 command 執行完畢
    const getInvokeCommandRequest = new ECSClientLib.DescribeInvocationsRequest(
      {
        regionId: this.regionId,
        invokeId: resp.body.invokeId,
        includeOption: true,
      },
    );

    const runtime2 = new Util.RuntimeOptions({
      connectTimeout: this.connectTimeout,
      readTimeout: this.connectTimeout,
    });

    await new Promise((resolve) => setTimeout(resolve, commandInitialWaitTime));

    while (true) {
      const resp2 = await this.client.describeInvocationsWithOptions(
        getInvokeCommandRequest,
        runtime2,
      );
      const invocation = resp2.body.invocations?.invocation?.[0]
        ?.invokeInstances?.invokeInstance?.[0];

      logger.debug("命令執行狀態", {
        id,
        status: invocation?.instanceInvokeStatus,
        invokeStatus: invocation?.invocationStatus
      });

      if (invocation == null) {
        logger.error("獲取命令執行結果失敗", { id, error: "invocation is null" });
        return { success: false, msg: "invocation is null" };
      }

      if (invocation.instanceInvokeStatus == "Running") {
        logger.debug("命令仍在執行中，等待 5 秒", { id });
        await new Promise((resolve) => setTimeout(resolve, commandPollingWaitTime));
      } else if (invocation.instanceInvokeStatus == "Finished") {
        const str = invocation.output as string;
        const decodedString = Buffer.from(str, "base64")
          .toString("utf8");

        logger.debug("命令執行輸出", { id, output: decodedString });

        if (invocation.invocationStatus !== "Success") {
          logger.error("命令執行失敗", {
            id,
            status: invocation.invocationStatus,
            output: decodedString
          });
          return {
            success: false,
            msg:
              `invocationStatus is not Success, ${invocation.invocationStatus}`,
          };
        } else {
          logger.info("命令執行成功", { id });
          return {
            success: true,
            msg: decodedString,
          };
        }
      } else {
        logger.error("命令執行異常", {
          id,
          status: invocation.instanceInvokeStatus,
          command
        });
        return {
          success: false,
          msg:
            `instanceInvokeStatus is ${invocation.instanceInvokeStatus}, command: ${command}`,
        };
      }
    }
  }
}

export const aliyunECS = new Client(
  accessKeyId,
  accessKeySecret,
  endpoint,
  regionId,
);
