# RAG 이해하기
* LLM 에게 지식을 전달하고 가르치려면 어떻게 해야할까?
![1.png](../assets/1.png)
  * LLM의 한계
    * 환각 (Hallucination)
    * 오래된 정보 (Outdated information)
    * 지식을 매개변수화(parameterizing knowledge)하는 데 효율성이 낮음 •전문 분야에 대한 심층적인 지식이 부족함
    * 약한 추론 능력
  * 실제 요구 사항
    * 도메인별 정확한 답변
    * 빈번한 데이터 업데이트
    * 생성된 콘텐츠의 추적성 및 설명성 •통제 가능한 비용
    * 데이터의 개인정보 보호
  * LLM에게 파인튜닝이란 어떤 뜻일까?
  ![3.png](../assets/3.png)
  * LLM에게 RAG란 어떤 뜻일까?
  ![2.png](../assets/2.png)
  ![4.png](../assets/4.png)

## RAG의 기본 파이프라인
* R (Retrieval)
  * 사용자의 질문이 주어집니다.
  * 애매모호한 질문은 어떻게 처리할 수 있을까요?
  * 질문을 통해 이를 임베딩으로 뽑습니다.
* A (Augment)
  * 벡터 DB에서 질문을 바탕으로 한 유사도를 뽑아서 가장 유사한 청크를 가져옵니다.
  * 청크를 N개 가져오고 난 후, 이를 Re-ranker에 태워서 후보의 가짓수를 좁힙니다.
* G (Generation)
  * LLM에 청크를 주어서 정답을 이끌어 냅니다.
  ```
  너는 친절한 QA 챗봇으로서 주어진 Chunk 를 가지고 정확하게 사용자의 질문에 대답하여야 해. 모르면 모른다고 말해야 해.
  ```

### 여러 용어들로 멘탈 모델 잡기
* 임베딩이란 무엇일까? 리랭킹이란 무엇일까?
  * 나에게 꼭 맞는 임베딩 모델은 무엇이 있을까?
  * 한국어를 잘하는 모델: OpenAI? Gemini? BGE-M3?
* 벡터 데이터베이스란 무엇일까?
* Chunking은 왜 필요한 것일까?
  * 청킹 전략에는 어떤 방법들이 있을까?
  * 오버랩이란 무엇일까?
  * 토큰/텍스트란 무엇일까?
* 그러면 우리의 입맛에 맞게 레시피를 조정해볼 수 있지 않을까?
  * 여러 가지의 임베딩 모델을 사용해서
  * 여러 가지의 청킹 전략 들을 사용해서
  * 이 결과물을 "앙상블" 하는 거에요
* RAG 청크 수가 너무 많으면 안좋다는 연구가 있습니다.
  * 적절한 청크 숫자가 있다 (k=20)
  * 마치 사람으로 치면 너무 많은 "컨닝 페이퍼" 를 주면 헷갈리는 것과 비슷하죠
  * 족집게가 필요하다는 뜻입니다.

## 관련 자료
* https://selectstar.ai/ko/blog/insight/rag-chunking-ko/
* https://brunch.co.kr/@b2439ea8fc654b8/37
* https://kjws0712.tistory.com/147
* https://velog.io/@autorag/RAG-%EB%8C%80%ED%91%9C%EC%A0%81%EC%9D%B8-%EC%B2%AD%ED%82%B9-%EB%B0%A9%EB%B2%95-5%EA%B0%80%EC%A7%80
* https://drive.google.com/file/d/1YKKiz1ff8Eu0yEOE_iaRfqGAKTZZGXQ4/view?usp=sharing
* https://brunch.co.kr/@ywkim36/146
* https://deci.ai/blog/fine-tuning-peft-prompt-engineering-and-rag-which-one-is-right-for-you/
* https://aclanthology.org/2023.findings-emnlp.776.pdf
