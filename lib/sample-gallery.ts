import sample01 from "@/sample-images/sample01.png";
import sample02 from "@/sample-images/sample02.png";
import sample03 from "@/sample-images/sample03.png";
import sample04 from "@/sample-images/Sample04.png";
import sample05 from "@/sample-images/Sample05.png";
import sample06 from "@/sample-images/Sample06.png";
import sample07 from "@/sample-images/Sample07.png";
import sample08 from "@/sample-images/Sample08.png";
import sample09 from "@/sample-images/Sample09.jpg";
import sample10 from "@/sample-images/Sample10.jpg";

export interface DemoSample {
  id: string;
  label: string;
  src: string;
  hint: string;
}

export const demoSamples: DemoSample[] = [
  { id: "sample01", label: "Sample 01", src: sample01.src, hint: "6x6 matrix / 4 buffer" },
  { id: "sample02", label: "Sample 02", src: sample02.src, hint: "5x5 matrix / 5 buffer" },
  { id: "sample03", label: "Sample 03", src: sample03.src, hint: "5x5 matrix / 5 buffer" },
  { id: "sample04", label: "Sample 04", src: sample04.src, hint: "Reference screenshot" },
  { id: "sample05", label: "Sample 05", src: sample05.src, hint: "Reference screenshot" },
  { id: "sample06", label: "Sample 06", src: sample06.src, hint: "Reference screenshot" },
  { id: "sample07", label: "Sample 07", src: sample07.src, hint: "Reference screenshot" },
  { id: "sample08", label: "Sample 08", src: sample08.src, hint: "Reference screenshot" },
  { id: "sample09", label: "Sample 09", src: sample09.src, hint: "JPG crop / 5x5 matrix" },
  { id: "sample10", label: "Sample 10", src: sample10.src, hint: "7x7 matrix / 8 buffer" },
];
