import * as React from "react"

import { StyleSheet, View, Text, Button } from "react-native"
import ExpoJobQueue from "expo-job-queue"

export default function App() {
  const [result, setResult] = React.useState<string | null>(null)

  React.useEffect(() => {
    ExpoJobQueue.configure({
      onQueueFinish: () => {
        console.log("Queue stopped and executed")
      },
    })

    ExpoJobQueue.addWorker("testWorker", async (payload) => {
      console.log("GOT PAYLOAD", payload)
      return new Promise((resolve) => {
        setTimeout(() => {
          setResult("JOB RAN: " + JSON.stringify(payload))
          resolve(undefined)
        }, payload.delay)
      })
    })
  }, [])

  return (
    <View style={styles.container}>
      <View style={styles.box}>
        <Text>{result ?? "NO RESULTS"}</Text>
      </View>
      <Button
        onPress={() => {
          setResult(null)
          ExpoJobQueue.addJob("testWorker", {
            text: "I ran Immediately",
          })
          ExpoJobQueue.start()
        }}
        title="Immediate Job"
      />
      <Button
        onPress={() => {
          setResult(null)
          ExpoJobQueue.addJob(
            "testWorker",
            {
              text: "I ran after 10 seconds",
            },
            {
              attempts: 3,
              runIn: {
                seconds: 10,
              },
              retryIn: {
                seconds: 10,
              },
            },
          )
          ExpoJobQueue.start()
        }}
        title="Run in 10 Seconds"
      />
      <Button
        onPress={() => {
          ExpoJobQueue.removeWorker("testWorker", true)
        }}
        title="Remove Worker"
      />
      <Button
        onPress={() => {
          ExpoJobQueue.removeAllJobsForWorker("testWorker")
        }}
        title="Cancel All Jobs"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    backgroundColor: "#F1F1F1",
    marginVertical: 20,
    padding: 40,
    borderRadius: 10,
  },
})
