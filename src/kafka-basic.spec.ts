import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KafkaContainer, StartedKafkaContainer } from "@testcontainers/kafka";
import { EachMessagePayload, Kafka } from "kafkajs";

describe("kafka-basic", () => {
  let kafkaContainer: StartedKafkaContainer;
  let kafkaConnection: Kafka;

  beforeAll(async () => {
    kafkaContainer = await new KafkaContainer().withExposedPorts(9093).start();
    const kafkaContainerHost = kafkaContainer.getHost();
    const kafkaContainerPort = kafkaContainer.getMappedPort(9093);
    kafkaConnection = new Kafka({
      clientId: "testClient",
      brokers: [`${kafkaContainerHost}:${kafkaContainerPort}`]
    });
  });

  afterAll(async () => {
    await kafkaContainer?.stop();
  });

  it("should produce and consume", async () => {
    // Given: topic exists
    const topic = "sampleTopic";
    const admin = kafkaConnection.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic }]
    });

    // And: a working producer
    const producer = kafkaConnection.producer();
    await producer.connect();

    // And: a working consumer consuming from a specified topic
    const consumedMessages: EachMessagePayload[] = [];
    const consumer = kafkaConnection.consumer({ groupId: "test-group" });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });
    await consumer.run({
      eachMessage: async (message) => {
        consumedMessages.push(message);
      }
    });

    // When: Messages are produced from the producer
    await producer.send({
      topic, messages: [{ key: "key1", value: "value1" }, { key: "key2", value: "value2" }]
    });

    // Then: messages are consumed by the consumer
    await expect.poll(() => consumedMessages.length).toBe(2);

    // And: 1st message matched
    expect(consumedMessages[0].message.key?.toString()).toEqual("key1");
    expect(consumedMessages[0].message.value?.toString()).toEqual("value1");
    expect(consumedMessages[0].message.offset).toBe('0');

    // And: 2nd message matched
    expect(consumedMessages[1].message.key?.toString()).toEqual("key2");
    expect(consumedMessages[1].message.value?.toString()).toEqual("value2");
    expect(consumedMessages[1].message.offset).toBe('1');

    // Finally: cleanup before we finish the test
    await admin.disconnect();
    await producer.disconnect();
    await consumer.disconnect();
  });

  function waitUntil(predicate: () => boolean, option: { timeout: number, checkInterval: number }): Promise<void> {
    if (option.checkInterval > option.timeout) {
      return Promise.reject(`option.timeout must be longer than option.checkInterval`);
    }

    const doWait = (timeout: number) => new Promise<void>(resolve => {
      setTimeout(() => {
        resolve();
      }, timeout);
    });

    return new Promise(async (resolve, reject) => {
      let checkCount = 0;
      let remainingTime = option.timeout;
      let done = false;

      while (remainingTime >= 0) {
        checkCount += 1;
        console.log(`Executing predicate - Round ${checkCount}`);
        done = predicate();

        if (done) {
          break;
        }

        remainingTime -= option.checkInterval;

        if (remainingTime >= 0) {
          console.log(`Condition not met. Retry again after ${option.checkInterval}ms`);
          await doWait(option.checkInterval);
        }
      }

      if (done) {
        resolve();
      } else {
        reject(`Condition not met after trying ${checkCount} times`);
      }
    });
  }
});